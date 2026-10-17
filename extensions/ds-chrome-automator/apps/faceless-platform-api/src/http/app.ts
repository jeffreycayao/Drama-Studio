import { randomBytes } from 'node:crypto';

import {
  createExtensionAuthFlowRequestSchema,
  createGuideRequestSchema,
  createExtensionAuthFlowResponseV1Schema,
  createExtensionAuthFlowResponseSchema,
  exchangeExtensionAuthFlowRequestV1Schema,
  exchangeExtensionAuthFlowRequestV2Schema,
  exchangeExtensionAuthFlowResponseV1Schema,
  exchangeExtensionAuthFlowResponseSchema,
  extensionAuthFlowPageResponseV1Schema,
  guideAdminListResponseSchema,
  guideSlugSchema,
  opaqueIdSchema,
  sessionSchema,
  startWebAuthQuerySchema,
  usageAuthorizationRequestSchema,
  usageAuthorizationResponseSchema,
  usageReservationCancelRequestSchema,
  usageReservationConsumeRequestSchema,
  usageReservationFinalizeRequestSchema,
  usageReservationRequestSchema,
  usageReservationResponseSchema,
  usageReservationRollbackRequestSchema,
  usageReservationTransitionResponseSchema,
  updateGuideRequestSchema,
  verifyExtensionAuthFlowRequestSchema,
  verifyExtensionAuthFlowResponseSchema,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod';

import { createBlobAdapter } from '../adapters/blob.js';
import { createGoogleIdentityAdapter } from '../adapters/google.js';
import { createNeonDatabase } from '../adapters/neon.js';
import {
  CURRENT_MIGRATION_VERSION,
  runNeonMigrations,
} from '../adapters/migrations.js';
import { createStripeAdapter } from '../adapters/stripe.js';
import {
  parseAdminConfig,
  parseBlobConfig,
  parseGoogleConfig,
  parseMigrationConfig,
  parsePublicConfig,
  parseSessionConfig,
  parseStripeConfig,
  parseUsageConfig,
} from '../config/env.js';
import {
  isLegacyProtocolAvailable,
  markLegacyProtocolResponse,
} from '../core/compatibility.js';
import {
  createOpaqueId,
  createExtensionUserCode,
  createPkceChallenge,
  createPrivacyKey,
  constantTimeEqual,
  decryptTransient,
  encryptTransient,
  hashSessionToken,
  sha256,
} from '../core/crypto.js';
import { HttpError, isHttpError } from '../core/errors.js';
import type {
  DatabasePort,
  UsageReservationTransition,
} from '../ports/database.js';
import type {
  BlobPort,
  GoogleIdentityPort,
  StripePort,
} from '../ports/providers.js';
import {
  cursorPageQuerySchema,
  reasonRequestSchema,
  updatePlatformSettingsRequestSchema,
} from '../schemas/admin.js';
import {
  checkoutIdempotencyHeaderSchema,
  createCheckoutRequestSchema,
} from '../schemas/commerce.js';
import {
  clearSecureCookie,
  createSecureCookie,
  getCsrfToken,
  isAdminSession,
  OAUTH_COOKIE_NAME,
  requireAdmin,
  requireAppSession,
  requireCsrf,
  requireSession,
  SESSION_COOKIE_NAME,
} from './auth.js';
import {
  applyCors,
  assertAllowedOrigin,
  createPreflightResponse,
} from './cors.js';
import { parseCookies, parseJsonBody, readRawBody } from './request.js';
import {
  applySecurityHeaders,
  errorResponse,
  jsonResponse,
} from './response.js';
import { extensionFlowPageResponseSchema } from '../schemas/extension.js';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';
import { createRateLimitBucket, createRateLimitSubject } from './rate-limit.js';

const googleCallbackQuerySchema = z
  .strictObject({
    code: z.string().min(16).max(4_096).optional(),
    error: z.string().min(1).max(128).optional(),
    state: z.string().min(16).max(256),
  })
  .refine(
    (value) =>
      (value.code !== undefined && value.error === undefined) ||
      (value.code === undefined && value.error !== undefined),
  );

const extensionGoogleStartQuerySchema = z.strictObject({
  client: z.literal('extension'),
  flowId: opaqueIdSchema,
});

const googleTransientSchema = z.strictObject({
  nonce: z.string().min(16),
  verifier: z.string().min(43).max(128),
});

const PAGE_LIMIT = 50;
const GUIDE_BODY_MAXIMUM_BYTES = 768 * 1_024;
const GOOGLE_FLOW_LIFETIME_SECONDS = 10 * 60;
const WEB_SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const APP_SESSION_LIFETIME_SECONDS = 15 * 60;
const EXTENSION_FLOW_POLL_SECONDS = 2;
const EXTENSION_FLOW_MAXIMUM_ATTEMPTS = 5;
const EXTENSION_FLOW_MAXIMUM_CONCURRENT = 5;
const GOOGLE_FLOW_MAXIMUM_CONCURRENT = 5;
const APP_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'grok-automator': 'Grok Automator™',
};

export interface PlatformAppOptions {
  readonly blob?: BlobPort;
  readonly database?: DatabasePort;
  readonly environment?: NodeJS.ProcessEnv;
  readonly google?: GoogleIdentityPort;
  readonly now?: () => Date;
  readonly stripe?: StripePort;
}

interface RateLimitRule {
  readonly includeClientSubject?: boolean;
  readonly keyParts: readonly string[];
  readonly limit: number;
  readonly scope: string;
  readonly windowSeconds: number;
}

function parsePathId(value: string | undefined): string {
  const parsed = opaqueIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'validation_failed',
      'Invalid resource identifier',
    );
  }
  return parsed.data;
}

function parseGuidePathSlug(value: string | undefined): string {
  const parsed = guideSlugSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(404, 'not_found', 'Guide was not found');
  }
  return parsed.data;
}

function parseCursorQuery(url: URL) {
  const rawQuery = url.searchParams.get('query')?.trim();
  const rawCursor = url.searchParams.get('cursor')?.trim();
  const query = rawQuery === '' ? undefined : rawQuery;
  const cursor = rawCursor === '' ? undefined : rawCursor;
  const parsed = cursorPageQuerySchema.safeParse({
    ...(query === undefined ? {} : { query }),
    ...(cursor === undefined ? {} : { cursor }),
  });
  if (!parsed.success) {
    throw new HttpError(422, 'validation_failed', 'Query validation failed');
  }
  return parsed.data;
}

function redirectResponse(
  location: string,
  cookies: readonly string[] = [],
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Location: location,
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { headers, status: 302 });
}

function safeAuthFailureUrl(
  appOrigin: string,
  reason: 'access_denied' | 'sign_in_failed',
): string {
  const target = new URL('/auth', appOrigin);
  target.searchParams.set('error', reason);
  return target.toString();
}

function extensionFlowPageUrl(appOrigin: string, flowId: string): string {
  return new URL(`/auth/extension/${flowId}`, appOrigin).toString();
}

function assertGoogleRedirectConfiguration(
  environment: NodeJS.ProcessEnv,
): void {
  const publicConfig = parsePublicConfig(environment);
  const googleConfig = parseGoogleConfig(environment);
  const expected = new URL(
    '/v1/auth/google/callback',
    publicConfig.apiOrigin,
  ).toString();
  if (googleConfig.oauthRedirectUri !== expected) {
    throw new Error(
      'Google callback configuration does not match the API origin',
    );
  }
}

function requireRegisteredExtension(input: {
  appId: string;
  environment: NodeJS.ProcessEnv;
  origin: string | null;
}): string {
  if (!input.origin?.startsWith('chrome-extension://')) {
    throw new HttpError(
      403,
      'forbidden',
      'Registered extension origin is required',
    );
  }
  const registered = parsePublicConfig(
    input.environment,
  ).extensionRegistrations.some(
    ({ appId, origin }) => appId === input.appId && origin === input.origin,
  );
  if (!registered) {
    throw new HttpError(
      403,
      'forbidden',
      'Registered extension origin is required',
    );
  }
  return input.origin;
}

function nextUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate() + 1,
    ),
  );
}

function usageTransitionPayload(transition: UsageReservationTransition) {
  const common = {
    appId: transition.appId,
    authorizationId: transition.authorizationId,
    operation: transition.operation,
    schemaVersion: 2 as const,
  };
  if (
    transition.status === 'accepted' &&
    transition.acceptanceId !== null &&
    transition.finalizeBy !== null
  ) {
    return usageReservationTransitionResponseSchema.parse({
      ...common,
      acceptanceId: transition.acceptanceId,
      finalizeBy: transition.finalizeBy,
      status: 'accepted',
    });
  }
  if (
    (transition.status === 'consumed' || transition.status === 'rolled_back') &&
    transition.acceptanceId !== null &&
    transition.finalizedAt !== null
  ) {
    return usageReservationTransitionResponseSchema.parse({
      ...common,
      acceptanceId: transition.acceptanceId,
      finalizedAt: transition.finalizedAt,
      status: transition.status,
    });
  }
  if (transition.status === 'cancelled' && transition.finalizedAt !== null) {
    return usageReservationTransitionResponseSchema.parse({
      ...common,
      finalizedAt: transition.finalizedAt,
      status: 'cancelled',
    });
  }
  throw new HttpError(409, 'conflict', 'Usage reservation cannot transition');
}

export function createPlatformApp(options: PlatformAppOptions = {}) {
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date());
  let database = options.database;
  let google = options.google;
  let stripe = options.stripe;
  let blob = options.blob;

  const getDatabase = (): DatabasePort => {
    database ??= createNeonDatabase(environment);
    return database;
  };
  const getGoogle = (): GoogleIdentityPort => {
    assertGoogleRedirectConfiguration(environment);
    google ??= createGoogleIdentityAdapter(environment);
    return google;
  };
  const getStripe = (): StripePort => {
    stripe ??= createStripeAdapter(environment);
    return stripe;
  };
  const getBlob = (): BlobPort => {
    blob ??= createBlobAdapter(environment);
    return blob;
  };

  async function bootstrapAdminIdentity(
    identity: Awaited<ReturnType<GoogleIdentityPort['exchangeAndVerify']>>,
    session: Awaited<ReturnType<DatabasePort['createGoogleSession']>>,
    timestamp: string,
  ): Promise<void> {
    const normalizedEmail = identity.email.toLowerCase();
    const { bootstrapEmails } = parseAdminConfig(environment);
    if (
      !bootstrapEmails.some((email) =>
        constantTimeEqual(email, normalizedEmail),
      )
    ) {
      return;
    }
    const { tokenPepper } = parseSessionConfig(environment);
    try {
      await getDatabase().claimAdminIdentity({
        auditId: createOpaqueId(),
        auditTargetId: createPrivacyKey(tokenPepper, 'admin-identity-audit', [
          identity.issuer,
          identity.subject,
        ]),
        email: normalizedEmail,
        issuer: identity.issuer,
        now: timestamp,
        subject: identity.subject,
        userId: session.userId,
      });
    } catch {
      // Admin bootstrap fails closed without denying an otherwise valid login.
      console.error(
        '[admin-bootstrap-failed]',
        JSON.stringify({ stage: 'persist_stable_identity' }),
      );
    }
  }

  async function enforceRateLimits(
    request: Request,
    rules: readonly RateLimitRule[],
  ): Promise<string> {
    const { tokenPepper } = parseSessionConfig(environment);
    const clientSubject = createRateLimitSubject({
      environment,
      pepper: tokenPepper,
      request,
    });
    const current = now();
    const allowed = await getDatabase().consumeRateLimits(
      rules.map((rule) =>
        createRateLimitBucket({
          keyParts: [
            ...(rule.includeClientSubject === false ? [] : [clientSubject]),
            ...rule.keyParts,
          ],
          limit: rule.limit,
          now: current,
          pepper: tokenPepper,
          scope: rule.scope,
          windowSeconds: rule.windowSeconds,
        }),
      ),
    );
    if (!allowed) {
      throw new HttpError(
        429,
        'rate_limited',
        'Request rate limit exceeded',
        60,
      );
    }
    return clientSubject;
  }

  async function handleGoogleStart(
    request: Request,
    url: URL,
  ): Promise<Response> {
    const rawClient = url.searchParams.get('client');
    const dashboardQuery = startWebAuthQuerySchema.safeParse({
      client: rawClient,
    });
    const extensionQuery = extensionGoogleStartQuerySchema.safeParse({
      client: rawClient,
      flowId: url.searchParams.get('flowId'),
    });
    if (!dashboardQuery.success && !extensionQuery.success) {
      throw new HttpError(
        422,
        'validation_failed',
        'Authentication request is invalid',
      );
    }
    const client = dashboardQuery.success ? 'dashboard' : 'extension';
    const extensionFlowId = extensionQuery.success
      ? extensionQuery.data.flowId
      : null;
    const clientSubject = await enforceRateLimits(request, [
      {
        keyParts: [client],
        limit: 12,
        scope: 'oauth-allocation-client',
        windowSeconds: 10 * 60,
      },
      {
        includeClientSubject: false,
        keyParts: [client],
        limit: 120,
        scope: 'oauth-allocation-global',
        windowSeconds: 60 * 60,
      },
    ]);
    if (extensionFlowId !== null) {
      const extensionFlow = await getDatabase().getExtensionAuthFlow(
        extensionFlowId,
        now().toISOString(),
      );
      if (
        extensionFlow?.status !== 'pending' ||
        (extensionFlow.protocolVersion === 2 &&
          extensionFlow.userId !== null) ||
        Date.parse(extensionFlow.expiresAt) <= now().getTime()
      ) {
        throw new HttpError(
          410,
          'auth_flow_expired',
          'Authentication flow is unavailable',
        );
      }
    }
    const state = createOpaqueId(32);
    const nonce = createOpaqueId(32);
    const verifier = randomBytes(64).toString('base64url');
    const googleConfig = parseGoogleConfig(environment);
    const expiresAt = new Date(
      now().getTime() + GOOGLE_FLOW_LIFETIME_SECONDS * 1_000,
    ).toISOString();
    const { tokenPepper } = parseSessionConfig(environment);
    const allocationKey = createPrivacyKey(
      tokenPepper,
      'oauth-flow-allocation',
      [client, extensionFlowId ?? clientSubject],
    );
    const created = await getDatabase().createGoogleOauthFlow(
      {
        allocationKey,
        client,
        encryptedCodeVerifier: encryptTransient(
          JSON.stringify({ nonce, verifier }),
          googleConfig.transientKey,
        ),
        expiresAt,
        extensionFlowId,
        nonceHash: sha256(nonce),
        stateHash: sha256(state),
      },
      extensionFlowId === null ? GOOGLE_FLOW_MAXIMUM_CONCURRENT : 1,
    );
    if (!created) {
      throw new HttpError(
        429,
        'rate_limited',
        'Too many concurrent authentication flows',
        60,
      );
    }
    const location = getGoogle().createAuthorizationUrl({
      codeChallenge: createPkceChallenge(verifier),
      nonce,
      state,
    });
    return redirectResponse(location, [
      createSecureCookie(
        OAUTH_COOKIE_NAME,
        state,
        GOOGLE_FLOW_LIFETIME_SECONDS,
      ),
    ]);
  }

  async function handleGoogleCallback(
    url: URL,
    request: Request,
  ): Promise<Response> {
    const publicConfig = parsePublicConfig(environment);
    const failureCookie = clearSecureCookie(OAUTH_COOKIE_NAME);
    let extensionFlowId: string | null = null;
    let callbackStage = 'validate_callback';
    try {
      const callback = googleCallbackQuerySchema.parse({
        ...(url.searchParams.get('code') === null
          ? {}
          : { code: url.searchParams.get('code') }),
        ...(url.searchParams.get('error') === null
          ? {}
          : { error: url.searchParams.get('error') }),
        state: url.searchParams.get('state'),
      });
      const cookieState = parseCookies(request.headers.get('cookie')).get(
        OAUTH_COOKIE_NAME,
      );
      if (
        cookieState === undefined ||
        !constantTimeEqual(cookieState, callback.state)
      )
        throw new Error('OAuth state mismatch');

      callbackStage = 'take_oauth_flow';
      const flow = await getDatabase().takeGoogleOauthFlow(
        sha256(callback.state),
        now().toISOString(),
      );
      if (flow === null) throw new Error('OAuth flow unavailable');
      extensionFlowId = flow.extensionFlowId;
      if (callback.error !== undefined || callback.code === undefined) {
        throw new Error('Google authorization was denied');
      }

      callbackStage = 'verify_google_identity';
      const googleConfig = parseGoogleConfig(environment);
      const transient = googleTransientSchema.parse(
        JSON.parse(
          decryptTransient(
            flow.encryptedCodeVerifier,
            googleConfig.transientKey,
          ),
        ),
      );
      if (!constantTimeEqual(sha256(transient.nonce), flow.nonceHash)) {
        throw new Error('OAuth nonce mismatch');
      }
      const identity = await getGoogle().exchangeAndVerify({
        code: callback.code,
        codeVerifier: transient.verifier,
        expectedNonce: transient.nonce,
      });
      const token = createOpaqueId(32);
      const sessionConfig = parseSessionConfig(environment);
      callbackStage = 'create_web_session';
      const session = await getDatabase().createGoogleSession({
        expiresAt: new Date(
          now().getTime() + WEB_SESSION_LIFETIME_SECONDS * 1_000,
        ).toISOString(),
        identity,
        newUserId: createOpaqueId(),
        sessionId: createOpaqueId(),
        tokenHash: hashSessionToken(token, sessionConfig.tokenPepper),
      });
      if (session.status === 'banned') {
        await getDatabase().revokeSession(
          session.sessionId,
          now().toISOString(),
        );
        if (extensionFlowId !== null) {
          await getDatabase().denyExtensionAuthFlow(
            extensionFlowId,
            now().toISOString(),
          );
          return redirectResponse(
            extensionFlowPageUrl(publicConfig.appOrigin, extensionFlowId),
            [failureCookie],
          );
        }
        return redirectResponse(
          safeAuthFailureUrl(publicConfig.appOrigin, 'access_denied'),
          [failureCookie],
        );
      }
      await bootstrapAdminIdentity(identity, session, now().toISOString());
      if (flow.client === 'extension') {
        if (extensionFlowId === null) {
          throw new Error('Extension flow binding is missing');
        }
        callbackStage = 'bind_extension_flow_identity';
        const callbackOutcome =
          await getDatabase().completeExtensionGoogleCallback({
            flowId: extensionFlowId,
            now: now().toISOString(),
            userId: session.userId,
          });
        if (callbackOutcome.status !== 'bound') {
          await getDatabase().revokeSession(
            session.sessionId,
            now().toISOString(),
          );
          if (callbackOutcome.status === 'unavailable') {
            await getDatabase().denyExtensionAuthFlow(
              extensionFlowId,
              now().toISOString(),
            );
          }
          return redirectResponse(
            extensionFlowPageUrl(publicConfig.appOrigin, extensionFlowId),
            [failureCookie],
          );
        }
        return redirectResponse(
          extensionFlowPageUrl(publicConfig.appOrigin, extensionFlowId),
          [
            failureCookie,
            createSecureCookie(
              SESSION_COOKIE_NAME,
              token,
              WEB_SESSION_LIFETIME_SECONDS,
            ),
          ],
        );
      }
      return redirectResponse(`${publicConfig.appOrigin}/`, [
        failureCookie,
        createSecureCookie(
          SESSION_COOKIE_NAME,
          token,
          WEB_SESSION_LIFETIME_SECONDS,
        ),
      ]);
    } catch {
      console.error(
        '[google-oauth-callback-failed]',
        JSON.stringify({ stage: callbackStage }),
      );
      if (extensionFlowId !== null) {
        try {
          await getDatabase().denyExtensionAuthFlow(
            extensionFlowId,
            now().toISOString(),
          );
        } catch {
          // The clean redirect remains safe even when denial persistence fails.
        }
        return redirectResponse(
          extensionFlowPageUrl(publicConfig.appOrigin, extensionFlowId),
          [failureCookie],
        );
      }
      return redirectResponse(
        safeAuthFailureUrl(publicConfig.appOrigin, 'sign_in_failed'),
        [failureCookie],
      );
    }
  }

  async function dispatch(request: Request, url: URL): Promise<Response> {
    const databasePort = getDatabase;
    const timestamp = now().toISOString();

    if (request.method === 'GET' && url.pathname === '/health/live') {
      return jsonResponse({ status: 'live' });
    }
    if (request.method === 'GET' && url.pathname === '/health/ready') {
      try {
        parsePublicConfig(environment);
        parseSessionConfig(environment);
        parseAdminConfig(environment);
        parseGoogleConfig(environment);
        assertGoogleRedirectConfiguration(environment);
        parseStripeConfig(environment);
        parseBlobConfig(environment);
        parseMigrationConfig(environment);
        parseUsageConfig(environment);
        const [, , migrationVersion] = await Promise.all([
          databasePort().ping(),
          getBlob().ping(),
          databasePort().getCurrentMigrationVersion(),
        ]);
        if (migrationVersion !== CURRENT_MIGRATION_VERSION) {
          throw new Error('Database migration is not at the source version');
        }
        getGoogle();
        getStripe();
        return jsonResponse({ status: 'ready' });
      } catch {
        return jsonResponse({ status: 'not_ready' }, 503);
      }
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/v1/internal/migrations'
    ) {
      if (request.headers.get('origin') !== null) {
        throw new HttpError(
          403,
          'forbidden',
          'Browser migration requests are forbidden',
        );
      }
      const authorization = request.headers.get('authorization');
      const { cronSecret } = parseMigrationConfig(environment);
      const expected = `Bearer ${cronSecret}`;
      if (
        authorization === null ||
        !constantTimeEqual(authorization, expected)
      ) {
        throw new HttpError(401, 'unauthorized', 'Authentication is required');
      }
      return jsonResponse({
        schemaVersion: 2,
        ...(await runNeonMigrations(environment)),
      });
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/v1/auth/extension-flows'
    ) {
      const body = await parseJsonBody(
        request,
        createExtensionAuthFlowRequestSchema,
      );
      const protocolVersion = 'schemaVersion' in body ? 2 : 1;
      const extensionOrigin = requireRegisteredExtension({
        appId: body.appId,
        environment,
        origin: request.headers.get('origin'),
      });
      const appDisplayName = APP_DISPLAY_NAMES[body.appId];
      if (appDisplayName === undefined) {
        throw new HttpError(404, 'not_found', 'Application is unavailable');
      }
      if (
        protocolVersion === 1 &&
        !isLegacyProtocolAvailable(new Date(timestamp))
      ) {
        throw new HttpError(
          426,
          'upgrade_required',
          'Extension authentication protocol version 2 is required',
        );
      }
      const clientSubject = await enforceRateLimits(request, [
        {
          keyParts: [body.appId],
          limit: 12,
          scope: 'extension-flow-allocation-client',
          windowSeconds: 10 * 60,
        },
        {
          includeClientSubject: false,
          keyParts: [body.appId, extensionOrigin],
          limit: 60,
          scope: 'extension-flow-allocation-registration',
          windowSeconds: 10 * 60,
        },
      ]);
      const flowId = createOpaqueId(32);
      const userCode = createExtensionUserCode();
      const { tokenPepper } = parseSessionConfig(environment);
      const expiresAt = new Date(
        now().getTime() + GOOGLE_FLOW_LIFETIME_SECONDS * 1_000,
      ).toISOString();
      const created = await databasePort().createExtensionAuthFlow(
        {
          allocationKey: createPrivacyKey(
            tokenPepper,
            'extension-flow-allocation',
            [clientSubject, body.appId, extensionOrigin],
          ),
          appId: body.appId,
          codeChallenge: body.codeChallenge,
          expiresAt,
          extensionOrigin,
          flowId,
          initiatorVerifiedAt: null,
          protocolVersion,
          status: 'pending',
          userId: null,
          userCodeHash: createPrivacyKey(tokenPepper, 'extension-user-code', [
            flowId,
            userCode,
          ]),
          verificationAttempts: 0,
        },
        EXTENSION_FLOW_MAXIMUM_CONCURRENT,
      );
      if (!created) {
        throw new HttpError(
          429,
          'rate_limited',
          'Too many concurrent authentication flows',
          60,
        );
      }
      const responseValue = {
        authorizationUrl: extensionFlowPageUrl(
          parsePublicConfig(environment).appOrigin,
          flowId,
        ),
        expiresAt,
        flowId,
        pollIntervalSeconds: EXTENSION_FLOW_POLL_SECONDS,
        provider: 'google',
      } as const;
      if (protocolVersion === 1) {
        return markLegacyProtocolResponse(
          jsonResponse(
            createExtensionAuthFlowResponseV1Schema.parse(responseValue),
            201,
          ),
        );
      }
      return jsonResponse(
        createExtensionAuthFlowResponseSchema.parse({
          ...responseValue,
          schemaVersion: 2,
          userCode,
        }),
        201,
      );
    }

    const extensionVerifyRoute =
      /^\/v1\/auth\/extension-flows\/([^/]+)\/verify$/u.exec(url.pathname);
    if (request.method === 'POST' && extensionVerifyRoute !== null) {
      const flowId = parsePathId(extensionVerifyRoute[1]);
      const appOrigin = parsePublicConfig(environment).appOrigin;
      if (request.headers.get('origin') !== appOrigin) {
        throw new HttpError(
          403,
          'forbidden',
          'The central authentication origin is required',
        );
      }
      const flow = await databasePort().getExtensionAuthFlow(flowId, timestamp);
      if (flow === null) {
        throw new HttpError(
          404,
          'not_found',
          'Authentication flow was not found',
        );
      }
      if (flow.protocolVersion !== 2) {
        throw new HttpError(
          409,
          'conflict',
          'Initiator verification is unavailable for a legacy flow',
        );
      }
      const session = await requireSession({
        database: databasePort(),
        environment,
        now: timestamp,
        request,
      });
      requireCsrf({ environment, request, session });
      if (flow.userId === null || flow.userId !== session.userId) {
        throw new HttpError(
          403,
          'forbidden',
          'Authentication flow is unavailable',
        );
      }
      await enforceRateLimits(request, [
        {
          keyParts: [flowId],
          limit: 8,
          scope: 'extension-flow-verify-client',
          windowSeconds: 10 * 60,
        },
        {
          includeClientSubject: false,
          keyParts: [flowId],
          limit: 12,
          scope: 'extension-flow-verify-flow',
          windowSeconds: 10 * 60,
        },
      ]);
      const body = await parseJsonBody(
        request,
        verifyExtensionAuthFlowRequestSchema,
      );
      const { tokenPepper } = parseSessionConfig(environment);
      const result = await databasePort().verifyExtensionAuthFlow({
        flowId,
        maximumAttempts: EXTENSION_FLOW_MAXIMUM_ATTEMPTS,
        now: timestamp,
        userId: session.userId,
        userCodeHash: createPrivacyKey(tokenPepper, 'extension-user-code', [
          flowId,
          body.userCode,
        ]),
      });
      if (result.status === 'invalid') {
        throw new HttpError(
          401,
          'unauthorized',
          'The extension verification code is invalid',
        );
      }
      if (result.status === 'unavailable') {
        throw new HttpError(
          410,
          'auth_flow_expired',
          'Authentication flow is unavailable',
        );
      }
      return jsonResponse(
        verifyExtensionAuthFlowResponseSchema.parse({
          attemptsRemaining: Math.max(
            EXTENSION_FLOW_MAXIMUM_ATTEMPTS - result.attempts,
            0,
          ),
          flowId,
          schemaVersion: 2,
          status: 'verified',
        }),
      );
    }

    const extensionFlowRoute = /^\/v1\/auth\/extension-flows\/([^/]+)$/u.exec(
      url.pathname,
    );
    if (request.method === 'GET' && extensionFlowRoute !== null) {
      const flowId = parsePathId(extensionFlowRoute[1]);
      const flow = await databasePort().getExtensionAuthFlow(flowId, timestamp);
      if (flow === null) {
        throw new HttpError(
          404,
          'not_found',
          'Authentication flow was not found',
        );
      }
      await enforceRateLimits(request, [
        {
          keyParts: [flowId],
          limit: 360,
          scope: 'extension-flow-poll-client',
          windowSeconds: 10 * 60,
        },
        {
          includeClientSubject: false,
          keyParts: [flowId],
          limit: 600,
          scope: 'extension-flow-poll-flow',
          windowSeconds: 10 * 60,
        },
      ]);
      const origin = request.headers.get('origin');
      if (origin?.startsWith('chrome-extension://') === true) {
        requireRegisteredExtension({
          appId: flow.appId,
          environment,
          origin,
        });
        if (origin !== flow.extensionOrigin) {
          throw new HttpError(
            403,
            'forbidden',
            'Authentication flow is unavailable',
          );
        }
      }
      const appDisplayName = APP_DISPLAY_NAMES[flow.appId];
      if (appDisplayName === undefined) {
        throw new HttpError(404, 'not_found', 'Application is unavailable');
      }
      const storedStatus =
        ['pending', 'authorized'].includes(flow.status) &&
        Date.parse(flow.expiresAt) <= now().getTime()
          ? 'expired'
          : flow.status;
      const status =
        flow.protocolVersion === 2 &&
        storedStatus === 'pending' &&
        flow.userId !== null &&
        flow.initiatorVerifiedAt === null
          ? 'verification_required'
          : storedStatus;
      const statusValue = {
        appDisplayName,
        appId: flow.appId,
        expiresAt: flow.expiresAt,
        flowId: flow.flowId,
        status,
      } as const;
      if (flow.protocolVersion === 1) {
        return markLegacyProtocolResponse(
          jsonResponse(
            extensionAuthFlowPageResponseV1Schema.parse({
              ...statusValue,
              schemaVersion: 1,
            }),
          ),
        );
      }
      let csrfToken: string | null = null;
      if (status === 'verification_required' && flow.userId !== null) {
        try {
          const session = await requireSession({
            database: databasePort(),
            environment,
            now: timestamp,
            request,
          });
          if (session.userId === flow.userId) {
            csrfToken = getCsrfToken(session, environment);
          }
        } catch (error) {
          if (!isHttpError(error)) throw error;
        }
      }
      return jsonResponse(
        extensionFlowPageResponseSchema.parse({
          ...statusValue,
          csrfToken,
          schemaVersion: 2,
          verificationAttemptsRemaining: Math.max(
            EXTENSION_FLOW_MAXIMUM_ATTEMPTS - flow.verificationAttempts,
            0,
          ),
        }),
      );
    }

    const extensionExchangeRoute =
      /^\/v1\/auth\/extension-flows\/([^/]+)\/exchange$/u.exec(url.pathname);
    if (request.method === 'POST' && extensionExchangeRoute !== null) {
      const flowId = parsePathId(extensionExchangeRoute[1]);
      const flow = await databasePort().getExtensionAuthFlow(flowId, timestamp);
      if (flow === null) {
        throw new HttpError(
          404,
          'not_found',
          'Authentication flow was not found',
        );
      }
      await enforceRateLimits(request, [
        {
          keyParts: [flowId],
          limit: 12,
          scope: 'extension-flow-exchange-client',
          windowSeconds: 10 * 60,
        },
        {
          includeClientSubject: false,
          keyParts: [flowId],
          limit: 30,
          scope: 'extension-flow-exchange-flow',
          windowSeconds: 10 * 60,
        },
      ]);
      const extensionOrigin = requireRegisteredExtension({
        appId: flow.appId,
        environment,
        origin: request.headers.get('origin'),
      });
      if (extensionOrigin !== flow.extensionOrigin) {
        throw new HttpError(
          403,
          'forbidden',
          'Authentication flow is unavailable',
        );
      }
      const body = await parseJsonBody(
        request,
        flow.protocolVersion === 1
          ? exchangeExtensionAuthFlowRequestV1Schema
          : exchangeExtensionAuthFlowRequestV2Schema,
      );
      if (
        !constantTimeEqual(
          createPkceChallenge(body.codeVerifier),
          flow.codeChallenge,
        )
      ) {
        throw new HttpError(
          401,
          'unauthorized',
          'Authentication flow proof is invalid',
        );
      }
      if (Date.parse(flow.expiresAt) <= now().getTime()) {
        throw new HttpError(
          410,
          'auth_flow_expired',
          'Authentication flow expired',
        );
      }
      if (flow.status === 'denied') {
        throw new HttpError(
          403,
          'auth_flow_denied',
          'Authentication flow was denied',
        );
      }
      if (flow.status === 'consumed') {
        throw new HttpError(
          409,
          'auth_flow_consumed',
          'Authentication flow was already used',
        );
      }
      if (flow.protocolVersion === 2 && flow.initiatorVerifiedAt === null) {
        throw new HttpError(
          409,
          'conflict',
          'Extension initiator verification is required',
        );
      }
      if (flow.status === 'pending') {
        const pending = {
          retryAfterSeconds: EXTENSION_FLOW_POLL_SECONDS,
          status: 'pending',
        } as const;
        return flow.protocolVersion === 1
          ? markLegacyProtocolResponse(
              jsonResponse(
                exchangeExtensionAuthFlowResponseV1Schema.parse(pending),
              ),
            )
          : jsonResponse(
              exchangeExtensionAuthFlowResponseSchema.parse({
                ...pending,
                schemaVersion: 2,
              }),
            );
      }

      const accessToken = createOpaqueId(32);
      const appSessionId = createOpaqueId(32);
      const issuedAt = timestamp;
      const expiresAt = new Date(
        now().getTime() + APP_SESSION_LIFETIME_SECONDS * 1_000,
      ).toISOString();
      const { tokenPepper } = parseSessionConfig(environment);
      const grant = await databasePort().consumeExtensionAuthFlow({
        appSessionId,
        appTokenHash: hashSessionToken(accessToken, tokenPepper),
        codeChallenge: flow.codeChallenge,
        expiresAt,
        extensionOrigin,
        flowId,
        now: issuedAt,
      });
      if (grant === null) {
        const latest = await databasePort().getExtensionAuthFlow(
          flowId,
          timestamp,
        );
        if (latest?.status === 'consumed') {
          throw new HttpError(
            409,
            'auth_flow_consumed',
            'Authentication flow was already used',
          );
        }
        throw new HttpError(403, 'forbidden', 'Account access is unavailable');
      }
      const capabilities =
        grant.planCode === 'free-plan'
          ? []
          : ['automation.run', 'automation.pro'];
      const session = sessionSchema.parse({
        access: {
          appId: flow.appId,
          capabilities,
          planCode: grant.planCode,
        },
        account: {
          ...(grant.displayName === null
            ? {}
            : { displayName: grant.displayName }),
          email: grant.email,
          emailVerified: true,
          provider: 'google',
          userId: grant.userId,
        },
        expiresAt,
        issuedAt,
        schemaVersion: 1,
        sessionId: appSessionId,
      });
      const authorizedResponse = {
        accessToken,
        expiresInSeconds: APP_SESSION_LIFETIME_SECONDS,
        session,
        status: 'authorized',
        tokenType: 'Bearer',
      } as const;
      return flow.protocolVersion === 1
        ? markLegacyProtocolResponse(
            jsonResponse(
              exchangeExtensionAuthFlowResponseV1Schema.parse(
                authorizedResponse,
              ),
            ),
          )
        : jsonResponse(
            exchangeExtensionAuthFlowResponseSchema.parse({
              ...authorizedResponse,
              schemaVersion: 2,
            }),
          );
    }

    const usageAuthorizationRoute =
      /^\/v1\/apps\/([^/]+)\/usage\/authorize$/u.exec(url.pathname);
    if (request.method === 'POST' && usageAuthorizationRoute !== null) {
      const appId = usageAuthorizationRoute[1] ?? '';
      const body = await parseJsonBody(
        request,
        usageAuthorizationRequestSchema,
      );
      if (body.appId !== appId) {
        throw new HttpError(
          422,
          'validation_failed',
          'Application binding does not match',
        );
      }
      if (!isLegacyProtocolAvailable(new Date(timestamp))) {
        throw new HttpError(
          426,
          'upgrade_required',
          'Two-phase usage reservations are required',
        );
      }
      const extensionOrigin = requireRegisteredExtension({
        appId,
        environment,
        origin: request.headers.get('origin'),
      });
      if (APP_DISPLAY_NAMES[appId] === undefined) {
        return markLegacyProtocolResponse(
          jsonResponse(
            usageAuthorizationResponseSchema.parse({
              allowed: false,
              appId,
              operation: body.operation,
              reason: 'app_disabled',
            }),
          ),
        );
      }
      const appSession = await requireAppSession({
        appId,
        database: databasePort(),
        environment,
        now: timestamp,
        origin: extensionOrigin,
        request,
      });
      if (body.operation !== 'automation.run') {
        return markLegacyProtocolResponse(
          jsonResponse(
            usageAuthorizationResponseSchema.parse({
              allowed: false,
              appId,
              operation: body.operation,
              reason: 'operation_disabled',
            }),
          ),
        );
      }
      const usageConfig = parseUsageConfig(environment);
      const decision = await databasePort().authorizeUsage({
        appId,
        appSessionId: appSession.sessionId,
        authorizationExpiresAt: new Date(
          now().getTime() + usageConfig.authorizationTtlSeconds * 1_000,
        ).toISOString(),
        authorizationId: createOpaqueId(32),
        dailyUnitLimit: usageConfig.dailyUnitLimit,
        idempotencyKey: body.idempotencyKey,
        now: timestamp,
        operation: body.operation,
        protocolVersion: 1,
        resetsAt: nextUtcDay(now()).toISOString(),
        units: body.units,
        userId: appSession.userId,
      });
      if (decision === null) {
        throw new HttpError(
          401,
          'unauthorized',
          'Application authentication is required',
        );
      }
      if (decision.kind === 'idempotency_conflict') {
        throw new HttpError(
          409,
          'conflict',
          'Idempotency key was already used for a different request',
        );
      }
      const reservation = decision.reservation;
      if (!reservation.allowed) {
        return markLegacyProtocolResponse(
          jsonResponse(
            usageAuthorizationResponseSchema.parse({
              allowed: false,
              appId,
              operation: body.operation,
              reason:
                reservation.status === 'denied'
                  ? reservation.reason
                  : 'quota_exhausted',
              ...('remainingUnits' in reservation
                ? { remainingUnits: reservation.remainingUnits }
                : {}),
              ...('resetsAt' in reservation
                ? { resetsAt: reservation.resetsAt }
                : {}),
            }),
          ),
        );
      }
      if (reservation.status === 'reserved') {
        const consumed = await databasePort().consumeLegacyUsageReservation({
          acceptanceId: body.idempotencyKey,
          appId,
          authorizationId: reservation.authorizationId,
          eventId: createOpaqueId(),
          now: timestamp,
          sessionId: appSession.sessionId,
          userId: appSession.userId,
        });
        if (
          consumed?.status !== 'consumed' ||
          consumed.acceptanceId !== body.idempotencyKey
        ) {
          throw new HttpError(
            409,
            'conflict',
            'Usage authorization cannot be consumed',
          );
        }
      } else if (reservation.status !== 'consumed') {
        throw new HttpError(
          409,
          'conflict',
          'Usage authorization is unavailable',
        );
      }
      return markLegacyProtocolResponse(
        jsonResponse(
          usageAuthorizationResponseSchema.parse({
            allowed: true,
            appId,
            operation: body.operation,
            authorizationId: reservation.authorizationId,
            authorizedUnits: reservation.authorizedUnits,
            remainingUnits: reservation.remainingUnits,
            ...('resetsAt' in reservation
              ? { resetsAt: reservation.resetsAt }
              : {}),
          }),
        ),
      );
    }

    const usageReservationRoute =
      /^\/v1\/apps\/([^/]+)\/usage\/reservations$/u.exec(url.pathname);
    if (request.method === 'POST' && usageReservationRoute !== null) {
      const appId = usageReservationRoute[1] ?? '';
      const body = await parseJsonBody(request, usageReservationRequestSchema);
      if (body.appId !== appId) {
        throw new HttpError(
          422,
          'validation_failed',
          'Application binding does not match',
        );
      }
      const extensionOrigin = requireRegisteredExtension({
        appId,
        environment,
        origin: request.headers.get('origin'),
      });
      if (APP_DISPLAY_NAMES[appId] === undefined) {
        return jsonResponse(
          usageReservationResponseSchema.parse({
            allowed: false,
            appId,
            operation: body.operation,
            reason: 'app_disabled',
            schemaVersion: 2,
            status: 'denied',
          }),
        );
      }
      const appSession = await requireAppSession({
        appId,
        database: databasePort(),
        environment,
        now: timestamp,
        origin: extensionOrigin,
        request,
      });
      if (body.operation !== 'automation.run') {
        return jsonResponse(
          usageReservationResponseSchema.parse({
            allowed: false,
            appId,
            operation: body.operation,
            reason: 'operation_disabled',
            schemaVersion: 2,
            status: 'denied',
          }),
        );
      }
      const usageConfig = parseUsageConfig(environment);
      const decision = await databasePort().authorizeUsage({
        appId,
        appSessionId: appSession.sessionId,
        authorizationExpiresAt: new Date(
          now().getTime() + usageConfig.authorizationTtlSeconds * 1_000,
        ).toISOString(),
        authorizationId: createOpaqueId(32),
        dailyUnitLimit: usageConfig.dailyUnitLimit,
        idempotencyKey: body.idempotencyKey,
        now: timestamp,
        operation: body.operation,
        protocolVersion: 2,
        resetsAt: nextUtcDay(now()).toISOString(),
        units: body.units,
        userId: appSession.userId,
      });
      if (decision === null) {
        throw new HttpError(
          401,
          'unauthorized',
          'Application authentication is required',
        );
      }
      if (decision.kind === 'idempotency_conflict') {
        throw new HttpError(
          409,
          'conflict',
          'Idempotency key was already used for different units or operation',
        );
      }
      return jsonResponse(
        usageReservationResponseSchema.parse(decision.reservation),
      );
    }

    const usageReservationTransitionRoute =
      /^\/v1\/apps\/([^/]+)\/usage\/reservations\/([^/]+)\/(consume|cancel|finalize|rollback)$/u.exec(
        url.pathname,
      );
    if (request.method === 'POST' && usageReservationTransitionRoute !== null) {
      const appId = usageReservationTransitionRoute[1] ?? '';
      const authorizationId = parsePathId(usageReservationTransitionRoute[2]);
      const action = usageReservationTransitionRoute[3];
      const extensionOrigin = requireRegisteredExtension({
        appId,
        environment,
        origin: request.headers.get('origin'),
      });
      if (APP_DISPLAY_NAMES[appId] === undefined) {
        throw new HttpError(404, 'not_found', 'Application is unavailable');
      }
      const appSession = await requireAppSession({
        appId,
        database: databasePort(),
        environment,
        now: timestamp,
        origin: extensionOrigin,
        request,
      });
      if (action === 'consume') {
        const body = await parseJsonBody(
          request,
          usageReservationConsumeRequestSchema,
        );
        const transition = await databasePort().acceptUsageReservation({
          acceptanceId: body.acceptanceId,
          acceptanceExpiresAt: new Date(
            now().getTime() +
              parseUsageConfig(environment).authorizationTtlSeconds * 1_000,
          ).toISOString(),
          appId,
          authorizationId,
          eventId: createOpaqueId(),
          now: timestamp,
          sessionId: appSession.sessionId,
          userId: appSession.userId,
        });
        if (
          transition === null ||
          !['accepted', 'consumed', 'rolled_back'].includes(
            transition.status,
          ) ||
          transition.acceptanceId !== body.acceptanceId
        ) {
          throw new HttpError(
            409,
            'conflict',
            'Usage reservation cannot be consumed',
          );
        }
        return jsonResponse(usageTransitionPayload(transition));
      }
      if (action === 'finalize' || action === 'rollback') {
        const body = await parseJsonBody(
          request,
          action === 'finalize'
            ? usageReservationFinalizeRequestSchema
            : usageReservationRollbackRequestSchema,
        );
        const transition = await (action === 'finalize'
          ? databasePort().finalizeUsageReservation({
              acceptanceId: body.acceptanceId,
              appId,
              authorizationId,
              eventId: createOpaqueId(),
              now: timestamp,
              sessionId: appSession.sessionId,
              userId: appSession.userId,
            })
          : databasePort().rollbackUsageReservation({
              acceptanceId: body.acceptanceId,
              appId,
              authorizationId,
              eventId: createOpaqueId(),
              now: timestamp,
              sessionId: appSession.sessionId,
              userId: appSession.userId,
            }));
        if (
          transition?.status !==
            (action === 'finalize' ? 'consumed' : 'rolled_back') ||
          transition.acceptanceId !== body.acceptanceId
        ) {
          throw new HttpError(
            409,
            'conflict',
            `Usage reservation cannot be ${action === 'finalize' ? 'finalized' : 'rolled back'}`,
          );
        }
        return jsonResponse(usageTransitionPayload(transition));
      }
      const body = await parseJsonBody(
        request,
        usageReservationCancelRequestSchema,
      );
      void body;
      const transition = await databasePort().cancelUsageReservation({
        appId,
        authorizationId,
        eventId: createOpaqueId(),
        now: timestamp,
        sessionId: appSession.sessionId,
        userId: appSession.userId,
      });
      if (transition?.status !== 'cancelled') {
        throw new HttpError(
          409,
          'conflict',
          'Usage reservation cannot be cancelled',
        );
      }
      return jsonResponse(
        usageReservationTransitionResponseSchema.parse({
          appId,
          authorizationId,
          finalizedAt: transition.finalizedAt,
          operation: transition.operation,
          schemaVersion: 2,
          status: 'cancelled',
        }),
      );
    }

    if (request.method === 'GET' && url.pathname === '/v1/platform-settings') {
      return jsonResponse(await databasePort().getPlatformSettings());
    }
    const publicGuideRoute = /^\/v1\/guides\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'GET' && publicGuideRoute !== null) {
      const slug = parseGuidePathSlug(publicGuideRoute[1]);
      const guide = await databasePort().getPublishedGuide(slug);
      if (guide === null) {
        throw new HttpError(404, 'not_found', 'Guide was not found');
      }
      return jsonResponse(guide);
    }
    if (request.method === 'GET' && url.pathname === '/v1/auth/google/start') {
      return handleGoogleStart(request, url);
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/v1/auth/google/callback'
    ) {
      return handleGoogleCallback(url, request);
    }
    if (request.method === 'GET' && url.pathname === '/v1/session') {
      const session = await requireSession({
        database: databasePort(),
        environment,
        now: timestamp,
        request,
      });
      return jsonResponse({
        authenticated: true,
        user: {
          displayName: session.displayName,
          email: session.email,
          id: session.userId,
        },
        admin: await isAdminSession({
          database: databasePort(),
          environment,
          session,
        }),
      });
    }
    if (request.method === 'POST' && url.pathname === '/v1/auth/logout') {
      const session = await requireSession({
        database: databasePort(),
        environment,
        now: timestamp,
        request,
      });
      await databasePort().revokeSession(session.sessionId, timestamp);
      const response = jsonResponse({ loggedOut: true });
      response.headers.append(
        'Set-Cookie',
        clearSecureCookie(SESSION_COOKIE_NAME),
      );
      return response;
    }

    if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const session = await requireSession({
        database: databasePort(),
        environment,
        now: timestamp,
        request,
      });
      const body = await parseJsonBody(request, createCheckoutRequestSchema);
      const idempotencyKey = checkoutIdempotencyHeaderSchema.safeParse(
        request.headers.get('idempotency-key'),
      );
      if (!idempotencyKey.success) {
        throw new HttpError(
          422,
          'validation_failed',
          'A valid Idempotency-Key is required',
        );
      }
      const publicConfig = parsePublicConfig(environment);
      const stripeConfig = parseStripeConfig(environment);
      const catalogItem = stripeConfig.catalog[body.productSlug];
      if (catalogItem === undefined) {
        throw new HttpError(404, 'not_found', 'Product is unavailable');
      }
      const checkoutUrl = await getStripe().createCheckout({
        appOrigin: publicConfig.appOrigin,
        catalogItem,
        idempotencyKey: idempotencyKey.data,
        productSlug: body.productSlug,
        userEmail: session.email,
        userId: session.userId,
      });
      return jsonResponse({ checkoutUrl }, 201);
    }
    if (request.method === 'POST' && url.pathname === '/v1/webhooks/stripe') {
      const signature = request.headers.get('stripe-signature');
      if (signature === null || signature.length > 2_048) {
        throw new HttpError(400, 'bad_request', 'Webhook signature is invalid');
      }
      const payload = await readRawBody(request);
      let event;
      try {
        event = await getStripe().verifyWebhook(payload, signature);
      } catch {
        throw new HttpError(400, 'bad_request', 'Webhook signature is invalid');
      }
      const inserted = await databasePort().enqueueStripeEvent({
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        payload,
        receivedAt: timestamp,
      });
      return jsonResponse({ duplicate: !inserted, received: true });
    }

    if (url.pathname.startsWith('/v1/admin/')) {
      const admin = await requireAdmin({
        database: databasePort(),
        environment,
        now: timestamp,
        request,
      });

      if (request.method === 'GET' && url.pathname === '/v1/admin/session') {
        return jsonResponse({
          account: {
            displayName: admin.displayName,
            email: admin.email,
            provider: 'google',
            role: 'admin',
            userId: admin.userId,
          },
          csrfToken: getCsrfToken(admin, environment),
          expiresAt: admin.expiresAt,
          schemaVersion: 1,
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/admin/overview') {
        return jsonResponse(await databasePort().getAdminOverview());
      }
      if (request.method === 'GET' && url.pathname === '/v1/admin/guides') {
        return jsonResponse(
          guideAdminListResponseSchema.parse({
            items: await databasePort().listGuides(),
          }),
        );
      }
      if (request.method === 'POST' && url.pathname === '/v1/admin/guides') {
        requireCsrf({ environment, request, session: admin });
        const body = await parseJsonBody(
          request,
          createGuideRequestSchema,
          GUIDE_BODY_MAXIMUM_BYTES,
        );
        const guide = await databasePort().createGuide({
          actorUserId: admin.userId,
          appId: body.appId,
          auditId: createOpaqueId(),
          content: body.content,
          now: timestamp,
          slug: body.slug,
          status: body.status,
          summary: body.summary,
          title: body.title,
        });
        if (guide === null) {
          throw new HttpError(409, 'conflict', 'Guide slug already exists');
        }
        return jsonResponse(guide, 201);
      }
      const adminGuideRoute = /^\/v1\/admin\/guides\/([^/]+)$/u.exec(
        url.pathname,
      );
      if (adminGuideRoute !== null) {
        const slug = parseGuidePathSlug(adminGuideRoute[1]);
        if (request.method === 'GET') {
          const guide = await databasePort().getGuide(slug);
          if (guide === null) {
            throw new HttpError(404, 'not_found', 'Guide was not found');
          }
          return jsonResponse(guide);
        }
        if (request.method === 'PUT') {
          requireCsrf({ environment, request, session: admin });
          const body = await parseJsonBody(
            request,
            updateGuideRequestSchema,
            GUIDE_BODY_MAXIMUM_BYTES,
          );
          const guide = await databasePort().updateGuide({
            actorUserId: admin.userId,
            appId: body.appId,
            auditId: createOpaqueId(),
            content: body.content,
            expectedRevision: body.expectedRevision,
            now: timestamp,
            slug,
            status: body.status,
            summary: body.summary,
            title: body.title,
          });
          if (guide !== null) return jsonResponse(guide);
          if ((await databasePort().getGuide(slug)) === null) {
            throw new HttpError(404, 'not_found', 'Guide was not found');
          }
          throw new HttpError(
            409,
            'conflict',
            'Guide changed; refresh and retry',
          );
        }
      }
      if (
        request.method === 'GET' &&
        url.pathname === '/v1/admin/platform-settings'
      ) {
        return jsonResponse(await databasePort().getPlatformSettings());
      }
      if (
        request.method === 'PUT' &&
        url.pathname === '/v1/admin/platform-settings'
      ) {
        requireCsrf({ environment, request, session: admin });
        const body = await parseJsonBody(
          request,
          updatePlatformSettingsRequestSchema,
        );
        const updated = await databasePort().updatePlatformSettings({
          actorUserId: admin.userId,
          auditId: createOpaqueId(),
          expectedRevision: body.expectedRevision,
          now: timestamp,
          value: { seo: body.seo, theme: body.theme },
        });
        if (updated === null) {
          throw new HttpError(
            409,
            'conflict',
            'Platform settings changed; refresh and retry',
          );
        }
        return jsonResponse(updated);
      }
      if (request.method === 'GET' && url.pathname === '/v1/admin/users') {
        const pageQuery = parseCursorQuery(url);
        return jsonResponse(
          await databasePort().listUsers({
            ...(pageQuery.cursor === undefined
              ? {}
              : { cursor: pageQuery.cursor }),
            ...(pageQuery.query === undefined
              ? {}
              : { query: pageQuery.query }),
            limit: PAGE_LIMIT,
          }),
        );
      }

      const userMutation = /^\/v1\/admin\/users\/([^/]+)\/(ban|unban)$/u.exec(
        url.pathname,
      );
      if (request.method === 'POST' && userMutation !== null) {
        requireCsrf({ environment, request, session: admin });
        const userId = parsePathId(userMutation[1]);
        if (userId === admin.userId) {
          throw new HttpError(
            409,
            'conflict',
            'Administrators cannot change their own status',
          );
        }
        const body = await parseJsonBody(request, reasonRequestSchema);
        const changed = await databasePort().setUserBan({
          actorUserId: admin.userId,
          auditId: createOpaqueId(),
          ban: userMutation[2] === 'ban',
          now: timestamp,
          reason: body.reason,
          userId,
        });
        if (!changed)
          throw new HttpError(404, 'not_found', 'User was not found');
        return jsonResponse({ schemaVersion: 1, updatedAt: timestamp });
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/v1/admin/entitlements'
      ) {
        const pageQuery = parseCursorQuery(url);
        return jsonResponse(
          await databasePort().listEntitlements({
            ...(pageQuery.cursor === undefined
              ? {}
              : { cursor: pageQuery.cursor }),
            ...(pageQuery.query === undefined
              ? {}
              : { query: pageQuery.query }),
            limit: PAGE_LIMIT,
          }),
        );
      }
      const entitlementMutation =
        /^\/v1\/admin\/entitlements\/([^/]+)\/revoke$/u.exec(url.pathname);
      if (request.method === 'POST' && entitlementMutation !== null) {
        requireCsrf({ environment, request, session: admin });
        const body = await parseJsonBody(request, reasonRequestSchema);
        const changed = await databasePort().revokeEntitlement({
          actorUserId: admin.userId,
          auditId: createOpaqueId(),
          entitlementId: parsePathId(entitlementMutation[1]),
          now: timestamp,
          reason: body.reason,
        });
        if (!changed) {
          throw new HttpError(
            404,
            'not_found',
            'Active entitlement was not found',
          );
        }
        return jsonResponse({ schemaVersion: 1, updatedAt: timestamp });
      }
      if (
        request.method === 'GET' &&
        url.pathname === '/v1/admin/audit-events'
      ) {
        const rawCursor = url.searchParams.get('cursor')?.trim();
        const { tokenPepper } = parseSessionConfig(environment);
        const cursor =
          rawCursor === undefined || rawCursor === ''
            ? undefined
            : decodeAuditCursor(rawCursor, tokenPepper);
        const page = await databasePort().listAuditEvents({
          ...(cursor === undefined ? {} : { cursor }),
          limit: PAGE_LIMIT,
        });
        return jsonResponse({
          items: page.items,
          nextCursor:
            page.nextCursor === null
              ? null
              : encodeAuditCursor(page.nextCursor, tokenPepper),
        });
      }
    }

    throw new HttpError(404, 'not_found', 'Route was not found');
  }

  return async function platformApp(request: Request): Promise<Response> {
    const requestId = createOpaqueId(12);
    const url = new URL(request.url);
    let allowedOrigin: string | null = null;
    try {
      const origin = request.headers.get('origin');
      if (origin !== null) {
        allowedOrigin = assertAllowedOrigin(
          origin,
          url.pathname,
          parsePublicConfig(environment),
        );
      }
      if (request.method === 'OPTIONS') {
        if (allowedOrigin === null) {
          throw new HttpError(403, 'forbidden', 'Origin is not allowed');
        }
        return applySecurityHeaders(
          createPreflightResponse(allowedOrigin),
          requestId,
        );
      }
      const response = await dispatch(request, url);
      return applySecurityHeaders(
        applyCors(response, allowedOrigin),
        requestId,
      );
    } catch (error) {
      const failure = isHttpError(error)
        ? errorResponse({
            code: error.code,
            message: error.message,
            requestId,
            ...(error.retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: error.retryAfterSeconds }),
            status: error.status,
          })
        : errorResponse({
            code:
              error instanceof z.ZodError
                ? 'service_unavailable'
                : 'internal_error',
            message:
              error instanceof z.ZodError
                ? 'Service configuration is incomplete'
                : 'The request could not be completed',
            requestId,
            status: error instanceof z.ZodError ? 503 : 500,
          });
      return applySecurityHeaders(applyCors(failure, allowedOrigin), requestId);
    }
  };
}
