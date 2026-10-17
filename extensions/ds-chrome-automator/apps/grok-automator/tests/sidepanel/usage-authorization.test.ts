import { describe, expect, it, vi } from 'vitest';

import type { StoredAppSession } from '../../src/sidepanel/auth-session';
import { createUsageAuthorizer } from '../../src/sidepanel/usage-authorization';

const NOW = Date.parse('2026-08-16T00:00:00.000Z');
const ACCEPTANCE_ID = 'run.1234567890abcdef';
const AUTHORIZATION_ID = 'authorization_1234567890';
const storedSession: StoredAppSession = {
  schemaVersion: 1,
  appAccessToken: 'application.token_1234567890abcdef',
  tokenType: 'Bearer',
  expiresAt: new Date(NOW + 15 * 60_000).toISOString(),
  session: {
    schemaVersion: 1,
    sessionId: 'session_1234567890abcdef',
    account: {
      userId: 'user_1234567890abcdef',
      provider: 'google',
      email: 'owner@example.test',
      emailVerified: true,
    },
    access: {
      appId: 'grok-automator',
      planCode: 'single-license',
      capabilities: ['automation.run'],
    },
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 15 * 60_000).toISOString(),
  },
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function dependencies() {
  return {
    loadSession: async () => storedSession,
    clearSession: async () => undefined,
    createAcceptanceId: () => ACCEPTANCE_ID,
    createSignal: () => new AbortController().signal,
    now: () => NOW,
    readConfig: () => ({ apiOrigin: 'https://api.example' }),
  };
}

function reservedResponse(units = 2) {
  return {
    schemaVersion: 2,
    allowed: true,
    status: 'reserved',
    appId: 'grok-automator',
    operation: 'automation.run',
    authorizationId: AUTHORIZATION_ID,
    authorizedUnits: units,
    remainingUnits: 98,
    expiresAt: new Date(NOW + 60_000).toISOString(),
  };
}

const FINALIZE_BY = new Date(NOW + 30_000).toISOString();

function transitionResponse(
  status: 'accepted' | 'consumed' | 'rolled_back' | 'cancelled',
) {
  const base = {
    schemaVersion: 2,
    appId: 'grok-automator',
    operation: 'automation.run',
    authorizationId: AUTHORIZATION_ID,
    status,
  };
  if (status === 'accepted') {
    return { ...base, acceptanceId: ACCEPTANCE_ID, finalizeBy: FINALIZE_BY };
  }
  if (status === 'cancelled') {
    return { ...base, finalizedAt: new Date(NOW).toISOString() };
  }
  return {
    ...base,
    acceptanceId: ACCEPTANCE_ID,
    finalizedAt: new Date(NOW).toISOString(),
  };
}

function legacyAllowedResponse(units = 2) {
  return {
    allowed: true,
    appId: 'grok-automator',
    operation: 'automation.run',
    authorizationId: AUTHORIZATION_ID,
    authorizedUnits: units,
    remainingUnits: 98,
  };
}

describe('server-authorized Run usage reservations', () => {
  it('requires a stored application session before making a request', async () => {
    const fetch = vi.fn();
    const authorizer = createUsageAuthorizer({
      ...dependencies(),
      loadSession: async () => null,
      fetch,
    });

    await expect(
      authorizer.reserveRun(2, ACCEPTANCE_ID),
    ).resolves.toMatchObject({
      status: 'authentication_required',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates the exact v2 reservation and accepts only matching units', async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => response(reservedResponse()),
    );
    const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

    expect(authorizer.createAcceptanceId()).toBe(ACCEPTANCE_ID);
    await expect(authorizer.reserveRun(2, ACCEPTANCE_ID)).resolves.toEqual({
      status: 'reserved',
      authorizationId: AUTHORIZATION_ID,
      remainingUnits: 98,
      lifecycle: 'reservation',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://api.example/v1/apps/grok-automator/usage/reservations',
    );
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${storedSession.appAccessToken}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      schemaVersion: 2,
      appId: 'grok-automator',
      operation: 'automation.run',
      units: 2,
      idempotencyKey: ACCEPTANCE_ID,
    });
  });

  it('reconciles a lost reservation response with the exact same idempotency key', async () => {
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new DOMException('Timed out', 'AbortError'))
      .mockResolvedValueOnce(response(reservedResponse()));
    const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

    await expect(authorizer.reserveRun(2, ACCEPTANCE_ID)).resolves.toEqual({
      status: 'reserved',
      authorizationId: AUTHORIZATION_ID,
      remainingUnits: 98,
      lifecycle: 'reservation',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(fetch.mock.calls[1]?.[0]);
    expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toMatchObject({
      idempotencyKey: ACCEPTANCE_ID,
    });
  });

  it('does not downgrade after an ambiguous v2 reservation attempt', async () => {
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new DOMException('Timed out', 'AbortError'))
      .mockResolvedValueOnce(response({ error: { code: 'not_found' } }, 404));
    const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

    await expect(
      authorizer.reserveRun(2, ACCEPTANCE_ID),
    ).resolves.toMatchObject({ status: 'unavailable' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(fetch.mock.calls[1]?.[0]);
  });

  it('uses exact accept, finalize, rollback, and cancel transition endpoints', async () => {
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response(transitionResponse('accepted')))
      .mockResolvedValueOnce(response(transitionResponse('consumed')))
      .mockResolvedValueOnce(response(transitionResponse('rolled_back')))
      .mockResolvedValueOnce(response(transitionResponse('cancelled')));
    const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

    await expect(
      authorizer.consumeReservation(AUTHORIZATION_ID, ACCEPTANCE_ID),
    ).resolves.toEqual({ status: 'accepted', finalizeBy: FINALIZE_BY });
    await expect(
      authorizer.finalizeReservation(AUTHORIZATION_ID, ACCEPTANCE_ID),
    ).resolves.toEqual({ status: 'consumed' });
    await expect(
      authorizer.rollbackReservation(AUTHORIZATION_ID, ACCEPTANCE_ID),
    ).resolves.toEqual({ status: 'rolled_back' });
    await expect(
      authorizer.cancelReservation(AUTHORIZATION_ID),
    ).resolves.toEqual({ status: 'cancelled' });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example/v1/apps/grok-automator/usage/reservations/${AUTHORIZATION_ID}/consume`,
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body))).toEqual({
      schemaVersion: 2,
      acceptanceId: ACCEPTANCE_ID,
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `https://api.example/v1/apps/grok-automator/usage/reservations/${AUTHORIZATION_ID}/finalize`,
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toEqual({
      schemaVersion: 2,
      acceptanceId: ACCEPTANCE_ID,
    });
    expect(fetch.mock.calls[2]?.[0]).toBe(
      `https://api.example/v1/apps/grok-automator/usage/reservations/${AUTHORIZATION_ID}/rollback`,
    );
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1].body))).toEqual({
      schemaVersion: 2,
      acceptanceId: ACCEPTANCE_ID,
    });
    expect(fetch.mock.calls[3]?.[0]).toBe(
      `https://api.example/v1/apps/grok-automator/usage/reservations/${AUTHORIZATION_ID}/cancel`,
    );
    expect(JSON.parse(String(fetch.mock.calls[3]?.[1].body))).toEqual({
      schemaVersion: 2,
    });
  });

  it('reconciles an ambiguous consume response by retrying the same exact transition', async () => {
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new DOMException('Timed out', 'AbortError'))
      .mockResolvedValueOnce(response(transitionResponse('accepted')));
    const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

    await expect(
      authorizer.consumeReservation(AUTHORIZATION_ID, ACCEPTANCE_ID),
    ).resolves.toEqual({ status: 'accepted', finalizeBy: FINALIZE_BY });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(fetch.mock.calls[1]?.[0]);
    expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toEqual({
      schemaVersion: 2,
      acceptanceId: ACCEPTANCE_ID,
    });
  });

  it.each([
    {
      status: 404,
      body: { error: { code: 'not_found' } },
    },
    {
      status: 426,
      body: {
        error: {
          code: 'upgrade_required',
          message: 'Use the legacy authorization route.',
          requestId: 'request_1234567890',
        },
      },
    },
  ])(
    'uses strict legacy authorization only for explicit protocol-unavailable HTTP $status',
    async ({ status, body }) => {
      const fetch = vi
        .fn<(url: string, init: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(response(body, status))
        .mockResolvedValueOnce(response(legacyAllowedResponse()));
      const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

      await expect(authorizer.reserveRun(2, ACCEPTANCE_ID)).resolves.toEqual({
        status: 'legacy_protocol',
      });
      await expect(
        authorizer.authorizeLegacyRun(2, ACCEPTANCE_ID),
      ).resolves.toEqual({
        status: 'consumed',
        authorizationId: AUTHORIZATION_ID,
        remainingUnits: 98,
        lifecycle: 'legacy-immediate',
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1]?.[0]).toBe(
        'https://api.example/v1/apps/grok-automator/usage/authorize',
      );
      expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toEqual({
        appId: 'grok-automator',
        operation: 'automation.run',
        units: 2,
        idempotencyKey: ACCEPTANCE_ID,
      });
    },
  );

  it('replays the exact legacy authorization after an ambiguous response', async () => {
    const fetch = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new DOMException('Timed out', 'AbortError'))
      .mockResolvedValueOnce(response(legacyAllowedResponse()));
    const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

    await expect(
      authorizer.authorizeLegacyRun(2, ACCEPTANCE_ID),
    ).resolves.toMatchObject({
      status: 'consumed',
      authorizationId: AUTHORIZATION_ID,
      lifecycle: 'legacy-immediate',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe(fetch.mock.calls[1]?.[0]);
    expect(fetch.mock.calls[0]?.[1].body).toBe(fetch.mock.calls[1]?.[1].body);
  });

  it.each([401, 403, 409, 410, 422, 429, 500])(
    'never downgrades usage authorization after HTTP %s',
    async (status) => {
      const fetch = vi.fn(async () =>
        response({ error: { code: 'request_rejected' } }, status),
      );
      const authorizer = createUsageAuthorizer({ ...dependencies(), fetch });

      await expect(
        authorizer.reserveRun(2, ACCEPTANCE_ID),
      ).resolves.not.toMatchObject({ lifecycle: 'legacy-immediate' });
      expect(fetch).toHaveBeenCalledTimes(status === 401 ? 1 : 3);
    },
  );

  it('never downgrades on network ambiguity, malformed success, or a forged 426 envelope', async () => {
    for (const fetch of [
      vi.fn(async () => {
        throw new TypeError('Network failed');
      }),
      vi.fn(async () => response({ allowed: true })),
      vi.fn(async () =>
        response(
          {
            error: {
              code: 'upgrade_required',
              message: 'missing exact request id',
            },
          },
          426,
        ),
      ),
    ]) {
      const authorizer = createUsageAuthorizer({
        ...dependencies(),
        fetch,
      });
      await expect(
        authorizer.reserveRun(2, ACCEPTANCE_ID),
      ).resolves.toMatchObject({ status: 'unavailable' });
      expect(fetch).toHaveBeenCalledTimes(3);
    }
  });

  it('returns entitlement denials without queue authority', async () => {
    const authorizer = createUsageAuthorizer({
      ...dependencies(),
      fetch: async () =>
        response({
          schemaVersion: 2,
          allowed: false,
          status: 'denied',
          appId: 'grok-automator',
          operation: 'automation.run',
          reason: 'entitlement_required',
        }),
    });

    await expect(authorizer.reserveRun(1, ACCEPTANCE_ID)).resolves.toEqual({
      status: 'denied',
      reason: 'entitlement_required',
      message:
        'A Grok Automator™ or All Extensions license is required before Run can start.',
    });
  });

  it('clears a rejected application session and fails closed on mismatches', async () => {
    const clearSession = vi.fn(async () => undefined);
    const rejected = createUsageAuthorizer({
      ...dependencies(),
      clearSession,
      fetch: async () => response({ error: 'unauthorized' }, 401),
    });
    await expect(rejected.reserveRun(1, ACCEPTANCE_ID)).resolves.toMatchObject({
      status: 'authentication_required',
    });
    expect(clearSession).toHaveBeenCalledOnce();

    const mismatched = createUsageAuthorizer({
      ...dependencies(),
      fetch: async () => response(reservedResponse(3)),
    });
    await expect(
      mismatched.reserveRun(2, ACCEPTANCE_ID),
    ).resolves.toMatchObject({
      status: 'unavailable',
    });

    const insecure = createUsageAuthorizer({
      ...dependencies(),
      readConfig: () => ({ apiOrigin: 'http://api.example' }),
      fetch: vi.fn(),
    });
    await expect(insecure.reserveRun(2, ACCEPTANCE_ID)).resolves.toMatchObject({
      status: 'unavailable',
    });
  });
});
