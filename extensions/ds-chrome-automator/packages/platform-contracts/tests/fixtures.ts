import { GROK_SELECTOR_KEYS } from '../src/config.js';

export const validSession = {
  schemaVersion: 1 as const,
  sessionId: 'session_1234567890abcdef',
  account: {
    userId: 'user_1234567890abcdef',
    provider: 'google' as const,
    email: 'owner@example.com',
    emailVerified: true as const,
    displayName: 'Owner',
  },
  access: {
    appId: 'grok-automator',
    planCode: 'free-plan',
    capabilities: ['automation.run', 'config.read'],
  },
  issuedAt: '2026-08-14T00:00:00.000Z',
  expiresAt: '2026-08-14T00:15:00.000Z',
};

export const validGrokSelectors = Object.fromEntries(
  GROK_SELECTOR_KEYS.map((key) => [key, `[data-contract="${key}"]`]),
);

export const validGrokConfigEnvelope = {
  schemaVersion: 1 as const,
  appId: 'grok-automator' as const,
  revision: 'release-2026.08.14',
  contentSha256: 'a'.repeat(64),
  compatibleClientVersions: ['0.0.2'],
  publishedAt: '2026-08-14T00:00:00.000Z',
  cacheSeconds: 300,
  payload: {
    selectors: validGrokSelectors,
  },
};
