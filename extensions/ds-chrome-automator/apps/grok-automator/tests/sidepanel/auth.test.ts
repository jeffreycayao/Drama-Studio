import { describe, expect, it, vi } from 'vitest';

import {
  PLATFORM_AUTH_CONFIG_MISSING_MESSAGE,
  createAuthController,
  resolvePlatformAuthConfig,
} from '../../src/sidepanel/auth';
import type { StoredAppSession } from '../../src/sidepanel/auth-session';

const NOW = Date.parse('2026-08-15T00:00:00.000Z');
const FLOW_ID = 'flow_1234567890abcdef';
const CODE_VERIFIER = 'verifier-0123456789._~ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authorizedResponse() {
  return {
    schemaVersion: 2 as const,
    status: 'authorized' as const,
    accessToken: 'application.token_1234567890abcdef',
    tokenType: 'Bearer' as const,
    expiresInSeconds: 900,
    session: {
      schemaVersion: 1 as const,
      sessionId: 'session_1234567890abcdef',
      account: {
        userId: 'user_1234567890abcdef',
        provider: 'google' as const,
        email: 'owner@example.test',
        emailVerified: true as const,
        displayName: 'Owner Account',
      },
      access: {
        appId: 'grok-automator',
        planCode: 'free-plan',
        capabilities: ['automation.run'],
      },
      issuedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 15 * 60_000).toISOString(),
    },
  };
}

function controllerDependencies() {
  return {
    now: () => NOW,
    readConfig: () => ({
      webOrigin: 'https://accounts.example',
      apiOrigin: 'https://api.example',
    }),
    createPkcePair: async () => ({
      verifier: CODE_VERIFIER,
      challenge: 'A'.repeat(43),
    }),
    wait: async () => undefined,
    loadSession: async () => null,
    saveSession: async () => undefined,
    purgeLegacySession: async () => undefined,
  };
}

describe('Google-only extension authentication', () => {
  it('accepts only explicit owned web and API origins', () => {
    expect(
      resolvePlatformAuthConfig(
        'https://accounts.example',
        'https://api.example',
      ),
    ).toEqual({
      webOrigin: 'https://accounts.example',
      apiOrigin: 'https://api.example',
    });
    expect(
      resolvePlatformAuthConfig('https://accounts.example', undefined),
    ).toBeNull();
    expect(
      resolvePlatformAuthConfig(
        'https://accounts.example',
        'http://api.example',
      ),
    ).toBeNull();
    expect(
      resolvePlatformAuthConfig(
        'http://192.168.1.20:5173',
        'http://192.168.1.20:3000',
      ),
    ).toBeNull();
    expect(
      resolvePlatformAuthConfig(
        'http://192.168.1.20:5173',
        'http://192.168.1.20:3000',
        true,
      ),
    ).toEqual({
      webOrigin: 'http://192.168.1.20:5173',
      apiOrigin: 'http://192.168.1.20:3000',
    });
  });

  it('fails closed without both origins and makes no request or tab', async () => {
    const fetch =
      vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
    const openTab = vi.fn<(url: string) => Promise<unknown>>();
    const controller = createAuthController({
      ...controllerDependencies(),
      readConfig: () => ({
        webOrigin: 'https://accounts.example',
        apiOrigin: undefined,
      }),
      fetch,
      openTab,
    });

    await expect(controller.signInWithGoogle()).resolves.toEqual({
      status: 'unavailable',
      message: PLATFORM_AUTH_CONFIG_MISSING_MESSAGE,
    });
    expect(controller.state.isLoggedIn).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
  });

  it('uses the shared PKCE contract and stores the authorized app session', async () => {
    const savedSessions: StoredAppSession[] = [];
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          schemaVersion: 2,
          flowId: FLOW_ID,
          provider: 'google',
          authorizationUrl: `https://accounts.example/auth/extension/${FLOW_ID}`,
          expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
          pollIntervalSeconds: 1,
          userCode: 'ABCD-EFGH',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(authorizedResponse()));
    let displayedUserCode = '';
    const openTab = vi.fn(async () => {
      displayedUserCode = controller.state.userCode;
    });
    const controller = createAuthController({
      ...controllerDependencies(),
      fetch,
      openTab,
      saveSession: async (session) => {
        savedSessions.push(session);
      },
    });

    await expect(controller.signInWithGoogle()).resolves.toEqual({
      status: 'authenticated',
      message: 'Signed in with Google through Paks Tools Faceless automations.',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.example/v1/auth/extension-flows',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body))).toEqual({
      schemaVersion: 2,
      appId: 'grok-automator',
      provider: 'google',
      codeChallenge: 'A'.repeat(43),
      codeChallengeMethod: 'S256',
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `https://api.example/v1/auth/extension-flows/${FLOW_ID}/exchange`,
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toEqual({
      schemaVersion: 2,
      codeVerifier: CODE_VERIFIER,
    });
    expect(openTab).toHaveBeenCalledWith(
      `https://accounts.example/auth/extension/${FLOW_ID}`,
    );
    expect(displayedUserCode).toBe('ABCD-EFGH');
    expect(controller.state.userCode).toBe('');
    expect(savedSessions).toHaveLength(1);
    expect(savedSessions[0]?.appAccessToken).toBe(
      authorizedResponse().accessToken,
    );
    expect(controller.state).toMatchObject({
      accountDisplayName: 'Owner Account',
      accountEmail: 'owner@example.test',
      isLoggedIn: true,
      isPro: false,
      planCode: 'free-plan',
    });
  });

  it('negotiates an exact legacy response while still preferring the v2 create request', async () => {
    const legacyAuthorized = { ...authorizedResponse() };
    delete (legacyAuthorized as { schemaVersion?: number }).schemaVersion;
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        jsonResponse({
          flowId: FLOW_ID,
          provider: 'google',
          authorizationUrl: `https://accounts.example/auth/extension/${FLOW_ID}`,
          expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
          pollIntervalSeconds: 1,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(legacyAuthorized));
    let displayedUserCode = 'not-cleared';
    const controller = createAuthController({
      ...controllerDependencies(),
      fetch,
      openTab: async () => {
        displayedUserCode = controller.state.userCode;
      },
    });

    await expect(controller.signInWithGoogle()).resolves.toMatchObject({
      status: 'authenticated',
    });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body))).toMatchObject({
      schemaVersion: 2,
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toEqual({
      codeVerifier: CODE_VERIFIER,
    });
    expect(displayedUserCode).toBe('');
  });

  it.each([
    { status: 422, code: 'validation_failed' },
    { status: 426, code: 'upgrade_required' },
  ])(
    'retries exact legacy create once for bounded HTTP $status protocol evidence',
    async ({ status, code }) => {
      const legacyAuthorized = { ...authorizedResponse() };
      delete (legacyAuthorized as { schemaVersion?: number }).schemaVersion;
      const fetch = vi
        .fn<(url: string, init: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: {
                code,
                message: 'Use the negotiated legacy request.',
                requestId: 'request_1234567890',
              },
            },
            status,
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            flowId: FLOW_ID,
            provider: 'google',
            authorizationUrl: `https://accounts.example/auth/extension/${FLOW_ID}`,
            expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
            pollIntervalSeconds: 1,
          }),
        )
        .mockResolvedValueOnce(jsonResponse(legacyAuthorized));
      const controller = createAuthController({
        ...controllerDependencies(),
        fetch,
        openTab: async () => undefined,
      });

      await expect(controller.signInWithGoogle()).resolves.toMatchObject({
        status: 'authenticated',
      });

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body))).toHaveProperty(
        'schemaVersion',
        2,
      );
      expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toEqual({
        appId: 'grok-automator',
        provider: 'google',
        codeChallenge: 'A'.repeat(43),
        codeChallengeMethod: 'S256',
      });
      expect(JSON.parse(String(fetch.mock.calls[2]?.[1].body))).toEqual({
        codeVerifier: CODE_VERIFIER,
      });
    },
  );

  it.each([422, 500])(
    'does not downgrade authentication after HTTP %s',
    async (status) => {
      const fetch = vi.fn(async () =>
        jsonResponse({ error: { code: 'invalid_request' } }, status),
      );
      const controller = createAuthController({
        ...controllerDependencies(),
        fetch,
        openTab: vi.fn(),
      });

      await expect(controller.signInWithGoogle()).resolves.toMatchObject({
        status: 'failed',
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it('does not downgrade a malformed successful auth response', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        flowId: FLOW_ID,
        provider: 'google',
        authorizationUrl: `https://accounts.example/auth/extension/${FLOW_ID}`,
        expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
        pollIntervalSeconds: 1,
        userCode: 'attacker-extra',
      }),
    );
    const openTab = vi.fn();
    const controller = createAuthController({
      ...controllerDependencies(),
      fetch,
      openTab,
    });

    await expect(controller.signInWithGoogle()).resolves.toMatchObject({
      status: 'failed',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(openTab).not.toHaveBeenCalled();
  });

  it('restores the account identity and paid plan from a stored app session', async () => {
    const authorized = authorizedResponse();
    const storedSession: StoredAppSession = {
      schemaVersion: 1,
      appAccessToken: authorized.accessToken,
      tokenType: authorized.tokenType,
      expiresAt: authorized.session.expiresAt,
      session: {
        ...authorized.session,
        access: {
          ...authorized.session.access,
          planCode: 'single-license',
          capabilities: ['automation.run', 'automation.pro'],
        },
      },
    };
    const controller = createAuthController({
      ...controllerDependencies(),
      loadSession: async () => storedSession,
    });

    await controller.restoreSession();

    expect(controller.state).toMatchObject({
      accountDisplayName: 'Owner Account',
      accountEmail: 'owner@example.test',
      isLoggedIn: true,
      isPro: true,
      planCode: 'single-license',
    });
  });

  it('clears account and plan presentation when no active session remains', async () => {
    const authorized = authorizedResponse();
    const storedSession: StoredAppSession = {
      schemaVersion: 1,
      appAccessToken: authorized.accessToken,
      tokenType: authorized.tokenType,
      expiresAt: authorized.session.expiresAt,
      session: authorized.session,
    };
    let activeSession: StoredAppSession | null = storedSession;
    const controller = createAuthController({
      ...controllerDependencies(),
      loadSession: async () => activeSession,
    });
    await controller.restoreSession();
    activeSession = null;

    await expect(controller.ensureActiveSession()).resolves.toBe(false);

    expect(controller.state).toMatchObject({
      accountDisplayName: '',
      accountEmail: '',
      isLoggedIn: false,
      isPro: false,
      planCode: '',
    });
  });

  it('cancels an in-flight exchange without authorizing a session', async () => {
    let markWaitStarted: (() => void) | undefined;
    const waitStarted = new Promise<void>((resolve) => {
      markWaitStarted = resolve;
    });
    const controller = createAuthController({
      ...controllerDependencies(),
      wait: (_milliseconds, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Canceled', 'AbortError')),
            { once: true },
          );
          markWaitStarted?.();
        }),
      fetch: async () =>
        jsonResponse({
          schemaVersion: 2,
          flowId: FLOW_ID,
          provider: 'google',
          authorizationUrl: `https://accounts.example/auth/extension/${FLOW_ID}`,
          expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
          pollIntervalSeconds: 1,
          userCode: 'ABCD-EFGH',
        }),
      openTab: async () => undefined,
    });

    const result = controller.signInWithGoogle();
    await waitStarted;
    controller.cancelGoogleSignIn();

    await expect(result).resolves.toMatchObject({ status: 'canceled' });
    expect(controller.state.isLoggedIn).toBe(false);
  });

  it('rolls back only the exact session when cancellation wins after save', async () => {
    const clearSessionIfMatching = vi.fn(async () => true);
    const controller = createAuthController({
      ...controllerDependencies(),
      fetch: vi
        .fn<(url: string, init: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(
          jsonResponse({
            schemaVersion: 2,
            flowId: FLOW_ID,
            provider: 'google',
            authorizationUrl: `https://accounts.example/auth/extension/${FLOW_ID}`,
            expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
            pollIntervalSeconds: 1,
            userCode: 'ABCD-EFGH',
          }),
        )
        .mockResolvedValueOnce(jsonResponse(authorizedResponse())),
      openTab: async () => undefined,
      saveSession: async () => controller.cancelGoogleSignIn(),
      clearSessionIfMatching,
    });

    await expect(controller.signInWithGoogle()).resolves.toMatchObject({
      status: 'canceled',
    });
    expect(clearSessionIfMatching).toHaveBeenCalledOnce();
    expect(controller.state.isLoggedIn).toBe(false);
  });
});
