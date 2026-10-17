import { reactive, readonly } from 'vue';
import { z } from 'zod/mini';

import {
  configuredOriginOrDefault,
  DEPLOYED_PLATFORM_API_ORIGIN,
  DEPLOYED_PLATFORM_WEB_ORIGIN,
} from '../config/deployment';
import { normalizePlatformWebOrigin } from '../config/platform';
import {
  createDeadlineSignal,
  readBoundedJson,
} from '../security/bounded-json';
import {
  parseCreateExtensionAuthFlowRequest,
  parseExchangeExtensionAuthFlowRequest,
  parseLegacyCreateExtensionAuthFlowRequest,
  parseLegacyCreateExtensionAuthFlowResponse,
  parseLegacyExchangeExtensionAuthFlowRequest,
  parseNegotiatedCreateExtensionAuthFlowResponse,
  parseNegotiatedExchangeExtensionAuthFlowResponse,
} from './auth-contract';
import {
  createStoredAppSession,
  clearAppSessionIfMatching,
  loadAppSession,
  saveAppSession,
  type StoredAppSession,
} from './auth-session';
import { purgeLegacyAuthStorage } from './storage';

const AUTH_RESPONSE_SIZE_LIMIT = 64 * 1_024;
const MAX_AUTH_FLOW_LIFETIME_MS = 15 * 60 * 1_000;
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

const authLegacyFallbackErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(['validation_failed', 'upgrade_required']),
    message: z.string().check(z.minLength(1), z.maxLength(500)),
    requestId: z
      .string()
      .check(z.minLength(1), z.maxLength(128), z.regex(/^[A-Za-z0-9_-]+$/u)),
    retryAfterSeconds: z.optional(
      z.number().check(z.int(), z.minimum(0), z.maximum(86_400)),
    ),
  }),
});

class AuthLegacyProtocolError extends Error {
  constructor() {
    super('The current authentication protocol is unavailable');
    this.name = 'AuthLegacyProtocolError';
  }
}

export const PLATFORM_AUTH_CONFIG_MISSING_MESSAGE =
  'Google sign-in requires configured Paks Tools Faceless automations web and API origins. Run was not started.';

export type GoogleSignInResult =
  | { status: 'authenticated'; message: string }
  | { status: 'canceled'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; message: string };

export interface PlatformAuthConfig {
  webOrigin: string;
  apiOrigin: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

type OpenTab = (url: string) => Promise<unknown>;
type AuthFetch = (url: string, init: RequestInit) => Promise<Response>;

interface AuthControllerDependencies {
  fetch: AuthFetch;
  openTab: OpenTab;
  createPkcePair: () => Promise<PkcePair>;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  readConfig: () => {
    webOrigin: unknown;
    apiOrigin: unknown;
    allowInsecurePrivateDevelopment?: boolean;
  };
  loadSession: (nowMilliseconds: number) => Promise<StoredAppSession | null>;
  saveSession: (
    value: StoredAppSession,
    nowMilliseconds: number,
  ) => Promise<void>;
  clearSessionIfMatching: (value: StoredAppSession) => Promise<boolean>;
  purgeLegacySession: () => Promise<void>;
}

export interface AuthController {
  state: Readonly<{
    isLoggedIn: boolean;
    isPro: boolean;
    isChecking: boolean;
    error: string;
    sessionExpiresAt: string;
    accountEmail: string;
    accountDisplayName: string;
    planCode: string;
    userCode: string;
  }>;
  restoreSession: () => Promise<void>;
  ensureActiveSession: () => Promise<boolean>;
  signInWithGoogle: () => Promise<GoogleSignInResult>;
  cancelGoogleSignIn: () => void;
}

export function resolvePlatformAuthConfig(
  webOrigin: unknown,
  apiOrigin: unknown,
  allowInsecurePrivateDevelopment = false,
): PlatformAuthConfig | null {
  const options = { allowInsecurePrivateDevelopment } as const;
  const normalizedWebOrigin = normalizePlatformWebOrigin(webOrigin, options);
  const normalizedApiOrigin = normalizePlatformWebOrigin(apiOrigin, options);
  if (!normalizedWebOrigin || !normalizedApiOrigin) return null;
  return {
    webOrigin: normalizedWebOrigin,
    apiOrigin: normalizedApiOrigin,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = bytesToBase64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return {
    verifier,
    challenge: bytesToBase64Url(new Uint8Array(digest)),
  };
}

function createAbortError(): DOMException {
  return new DOMException('Authentication canceled', 'AbortError');
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(createAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function postJson(
  fetchImplementation: AuthFetch,
  url: string,
  body: unknown,
  signal: AbortSignal,
  allowLegacyFallback = false,
): Promise<unknown> {
  const deadline = createDeadlineSignal(signal, AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: deadline.signal,
    });
    if (
      allowLegacyFallback &&
      (response.status === 422 || response.status === 426)
    ) {
      const rawError = await readBoundedJson(response, {
        maxBytes: AUTH_RESPONSE_SIZE_LIMIT,
        sizeErrorMessage: 'Authentication response exceeded the size limit.',
        invalidJsonMessage: 'Authentication response was not valid JSON.',
      });
      const parsedError = authLegacyFallbackErrorSchema.safeParse(rawError);
      const expectedCode =
        response.status === 422 ? 'validation_failed' : 'upgrade_required';
      if (parsedError.success && parsedError.data.error.code === expectedCode) {
        throw new AuthLegacyProtocolError();
      }
      throw new Error(
        'The central authentication service rejected the request.',
      );
    }
    if (!response.ok) {
      throw new Error(
        'The central authentication service rejected the request.',
      );
    }
    return await readBoundedJson(response, {
      maxBytes: AUTH_RESPONSE_SIZE_LIMIT,
      sizeErrorMessage: 'Authentication response exceeded the size limit.',
      invalidJsonMessage: 'Authentication response was not valid JSON.',
    });
  } finally {
    deadline.dispose();
  }
}

function validateAuthorizationPage(
  config: PlatformAuthConfig,
  flow: {
    flowId: string;
    authorizationUrl: string;
    expiresAt: string;
  },
  nowMilliseconds: number,
): number {
  const expiresAt = Date.parse(flow.expiresAt);
  if (
    expiresAt <= nowMilliseconds ||
    expiresAt - nowMilliseconds > MAX_AUTH_FLOW_LIFETIME_MS
  ) {
    throw new Error('The central authentication flow has an invalid expiry.');
  }

  const authorizationUrl = new URL(flow.authorizationUrl);
  const expectedPath = `/auth/extension/${flow.flowId}`;
  if (
    authorizationUrl.origin !== config.webOrigin ||
    authorizationUrl.pathname !== expectedPath ||
    authorizationUrl.search ||
    authorizationUrl.hash
  ) {
    throw new Error(
      'The central authentication page is not an owned flow URL.',
    );
  }
  return expiresAt;
}

function isProSession(session: StoredAppSession): boolean {
  return (
    session.session.access.planCode !== 'free-plan' ||
    session.session.access.capabilities.includes('automation.pro')
  );
}

function defaultAuthEnvironment(): {
  webOrigin: unknown;
  apiOrigin: unknown;
  allowInsecurePrivateDevelopment: boolean;
} {
  const environment = import.meta.env as ImportMetaEnv & {
    readonly DEV?: boolean;
    readonly WXT_PLATFORM_API_ORIGIN?: string;
  };
  return {
    webOrigin: configuredOriginOrDefault(
      environment.WXT_PLATFORM_WEB_ORIGIN,
      DEPLOYED_PLATFORM_WEB_ORIGIN,
    ),
    apiOrigin: configuredOriginOrDefault(
      environment.WXT_PLATFORM_API_ORIGIN,
      DEPLOYED_PLATFORM_API_ORIGIN,
    ),
    allowInsecurePrivateDevelopment: environment.DEV === true,
  };
}

export function createAuthController(
  overrides: Partial<AuthControllerDependencies> = {},
): AuthController {
  const dependencies: AuthControllerDependencies = {
    fetch: (url, init) => fetch(url, init),
    openTab: async (url) => chrome.tabs.create({ url }),
    createPkcePair,
    wait,
    now: Date.now,
    readConfig: defaultAuthEnvironment,
    loadSession: loadAppSession,
    saveSession: saveAppSession,
    clearSessionIfMatching: clearAppSessionIfMatching,
    purgeLegacySession: purgeLegacyAuthStorage,
    ...overrides,
  };
  const state = reactive({
    isLoggedIn: false,
    isPro: false,
    isChecking: false,
    error: '',
    sessionExpiresAt: '',
    accountEmail: '',
    accountDisplayName: '',
    planCode: '',
    userCode: '',
  });
  let activeSignIn: AbortController | null = null;
  let restorePromise: Promise<void> | null = null;

  function applySession(session: StoredAppSession | null): void {
    Object.assign(state, {
      isLoggedIn: session !== null,
      isPro: session ? isProSession(session) : false,
      sessionExpiresAt: session?.expiresAt ?? '',
      accountEmail: session?.session.account.email ?? '',
      accountDisplayName: session?.session.account.displayName ?? '',
      planCode: session?.session.access.planCode ?? '',
    });
  }

  async function restoreSession(): Promise<void> {
    if (restorePromise) return restorePromise;
    restorePromise = (async () => {
      state.isChecking = true;
      state.error = '';
      try {
        await dependencies.purgeLegacySession();
        applySession(await dependencies.loadSession(dependencies.now()));
      } catch {
        applySession(null);
        state.error =
          'Could not restore the Paks Tools Faceless automations session.';
      } finally {
        state.isChecking = false;
      }
    })();
    try {
      await restorePromise;
    } finally {
      restorePromise = null;
    }
  }

  async function ensureActiveSession(): Promise<boolean> {
    try {
      const session = await dependencies.loadSession(dependencies.now());
      applySession(session);
      return session !== null;
    } catch {
      applySession(null);
      state.error =
        'Could not verify the Paks Tools Faceless automations session.';
      return false;
    }
  }

  async function signInWithGoogle(): Promise<GoogleSignInResult> {
    if (activeSignIn) {
      return {
        status: 'failed',
        message: 'Google sign-in is already in progress.',
      };
    }

    const rawConfig = dependencies.readConfig();
    const config = resolvePlatformAuthConfig(
      rawConfig.webOrigin,
      rawConfig.apiOrigin,
      rawConfig.allowInsecurePrivateDevelopment === true,
    );
    if (!config) {
      state.error = PLATFORM_AUTH_CONFIG_MISSING_MESSAGE;
      return {
        status: 'unavailable',
        message: PLATFORM_AUTH_CONFIG_MISSING_MESSAGE,
      };
    }

    const abortController = new AbortController();
    activeSignIn = abortController;
    state.isChecking = true;
    state.error = '';
    try {
      const pkce = await dependencies.createPkcePair();
      const createRequest = parseCreateExtensionAuthFlowRequest({
        schemaVersion: 2,
        appId: 'grok-automator',
        provider: 'google',
        codeChallenge: pkce.challenge,
        codeChallengeMethod: 'S256',
      });
      let negotiatedCreate;
      try {
        negotiatedCreate = parseNegotiatedCreateExtensionAuthFlowResponse(
          await postJson(
            dependencies.fetch,
            new URL('/v1/auth/extension-flows', config.apiOrigin).toString(),
            createRequest,
            abortController.signal,
            true,
          ),
        );
      } catch (error) {
        if (!(error instanceof AuthLegacyProtocolError)) throw error;
        const legacyCreateRequest = parseLegacyCreateExtensionAuthFlowRequest({
          appId: 'grok-automator',
          provider: 'google',
          codeChallenge: pkce.challenge,
          codeChallengeMethod: 'S256',
        });
        negotiatedCreate = {
          protocolVersion: 1 as const,
          value: parseLegacyCreateExtensionAuthFlowResponse(
            await postJson(
              dependencies.fetch,
              new URL('/v1/auth/extension-flows', config.apiOrigin).toString(),
              legacyCreateRequest,
              abortController.signal,
            ),
          ),
        };
      }
      const createResponse = negotiatedCreate.value;
      const flowExpiresAt = validateAuthorizationPage(
        config,
        createResponse,
        dependencies.now(),
      );
      state.userCode =
        negotiatedCreate.protocolVersion === 2
          ? negotiatedCreate.value.userCode
          : '';
      await dependencies.openTab(createResponse.authorizationUrl);

      let waitSeconds = createResponse.pollIntervalSeconds;
      while (dependencies.now() < flowExpiresAt) {
        await dependencies.wait(waitSeconds * 1_000, abortController.signal);
        if (dependencies.now() >= flowExpiresAt) break;

        const exchangeRequest =
          negotiatedCreate.protocolVersion === 2
            ? parseExchangeExtensionAuthFlowRequest({
                schemaVersion: 2,
                codeVerifier: pkce.verifier,
              })
            : parseLegacyExchangeExtensionAuthFlowRequest({
                codeVerifier: pkce.verifier,
              });
        const negotiatedExchange =
          parseNegotiatedExchangeExtensionAuthFlowResponse(
            negotiatedCreate.protocolVersion,
            await postJson(
              dependencies.fetch,
              new URL(
                `/v1/auth/extension-flows/${createResponse.flowId}/exchange`,
                config.apiOrigin,
              ).toString(),
              exchangeRequest,
              abortController.signal,
            ),
          );
        const exchangeResponse = negotiatedExchange.value;
        if (exchangeResponse.status === 'pending') {
          waitSeconds = exchangeResponse.retryAfterSeconds;
          continue;
        }

        if (abortController.signal.aborted) throw createAbortError();
        const session = createStoredAppSession(
          exchangeResponse,
          dependencies.now(),
        );
        await dependencies.saveSession(session, dependencies.now());
        if (abortController.signal.aborted) {
          await dependencies.clearSessionIfMatching(session);
          throw createAbortError();
        }
        applySession(session);
        return {
          status: 'authenticated',
          message:
            'Signed in with Google through Paks Tools Faceless automations.',
        };
      }
      throw new Error('The Google sign-in window expired.');
    } catch (error) {
      if (isAbortError(error)) {
        return {
          status: 'canceled',
          message: 'Google sign-in was canceled. Run was not started.',
        };
      }
      const message =
        error instanceof Error &&
        (error.message === 'The Google sign-in window expired.' ||
          error.message ===
            'The central authentication page is not an owned flow URL.')
          ? error.message
          : 'Google sign-in could not be completed. Run was not started.';
      state.error = message;
      return { status: 'failed', message };
    } finally {
      if (activeSignIn === abortController) activeSignIn = null;
      state.userCode = '';
      state.isChecking = false;
    }
  }

  function cancelGoogleSignIn(): void {
    activeSignIn?.abort();
  }

  return {
    state: readonly(state),
    restoreSession,
    ensureActiveSession,
    signInWithGoogle,
    cancelGoogleSignIn,
  };
}

const auth = createAuthController();

export function useAuth(): AuthController {
  return auth;
}
