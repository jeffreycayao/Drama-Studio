import { describe, expect, it } from 'vitest';

import { sessionSchema } from '../src/index.js';
import { validSession } from './fixtures.js';

describe('platform session contract', () => {
  it('accepts a verified Google account and bounded app access', () => {
    expect(sessionSchema.parse(validSession)).toEqual(validSession);
  });

  it('rejects unverified identities and non-Google providers', () => {
    expect(
      sessionSchema.safeParse({
        ...validSession,
        account: { ...validSession.account, emailVerified: false },
      }).success,
    ).toBe(false);
    expect(
      sessionSchema.safeParse({
        ...validSession,
        account: { ...validSession.account, provider: 'password' },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate capabilities and invalid expiration order', () => {
    expect(
      sessionSchema.safeParse({
        ...validSession,
        access: {
          ...validSession.access,
          capabilities: ['automation.run', 'automation.run'],
        },
      }).success,
    ).toBe(false);
    expect(
      sessionSchema.safeParse({
        ...validSession,
        expiresAt: validSession.issuedAt,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields at nested boundaries', () => {
    expect(
      sessionSchema.safeParse({
        ...validSession,
        account: {
          ...validSession.account,
          googleSubject: 'must-stay-server-side',
        },
      }).success,
    ).toBe(false);
  });
});
