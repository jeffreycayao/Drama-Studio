import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  createStoredAppSession,
  clearAppSessionIfMatching,
  loadAppSession,
  saveAppSession,
} from '../../src/sidepanel/auth-session';

const NOW = Date.parse('2026-08-15T00:00:00.000Z');

function authorizedResponse(lifetimeMinutes = 15) {
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
      },
      access: {
        appId: 'grok-automator',
        planCode: 'free-plan',
        capabilities: ['automation.run'],
      },
      issuedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + lifetimeMinutes * 60_000).toISOString(),
    },
  };
}

describe('short-lived application session storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('stores only a validated Paks Tools Faceless automations session in WXT session storage', async () => {
    const session = createStoredAppSession(authorizedResponse(), NOW);
    await saveAppSession(session, NOW);

    await expect(loadAppSession(NOW)).resolves.toEqual(session);
    const rawStorage = await fakeBrowser.storage.session.get();
    expect(Object.keys(rawStorage)).toEqual(['faceless-app-session']);
    expect(JSON.stringify(rawStorage)).not.toMatch(
      /codeVerifier|googleAccessToken|googleIdToken|providerToken|refreshToken/u,
    );
  });

  it('removes an expired session instead of restoring it', async () => {
    const session = createStoredAppSession(authorizedResponse(), NOW);
    await saveAppSession(session, NOW);

    await expect(loadAppSession(NOW + 16 * 60_000)).resolves.toBeNull();
    await expect(fakeBrowser.storage.session.get()).resolves.toEqual({});
  });

  it('rejects a session for another app or longer than one hour', () => {
    expect(() =>
      createStoredAppSession(
        {
          ...authorizedResponse(),
          session: {
            ...authorizedResponse().session,
            access: {
              ...authorizedResponse().session.access,
              appId: 'another-app',
            },
          },
        },
        NOW,
      ),
    ).toThrow(/invalid or expired app session/u);
    expect(() => createStoredAppSession(authorizedResponse(61), NOW)).toThrow(
      /invalid or expired app session/u,
    );
  });

  it('never clears a newer session while rolling back an older commit', async () => {
    const first = createStoredAppSession(authorizedResponse(), NOW);
    const second = createStoredAppSession(
      {
        ...authorizedResponse(),
        accessToken: 'application.new_token_1234567890abcdef',
        session: {
          ...authorizedResponse().session,
          sessionId: 'session_new_1234567890abcdef',
        },
      },
      NOW,
    );
    await saveAppSession(second, NOW);

    await expect(clearAppSessionIfMatching(first)).resolves.toBe(false);
    await expect(loadAppSession(NOW)).resolves.toEqual(second);
    await expect(clearAppSessionIfMatching(second)).resolves.toBe(true);
    await expect(loadAppSession(NOW)).resolves.toBeNull();
  });
});
