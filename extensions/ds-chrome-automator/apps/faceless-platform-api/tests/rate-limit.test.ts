import { describe, expect, it } from 'vitest';

import {
  createRateLimitBucket,
  createRateLimitSubject,
  TRUSTED_CLIENT_ADDRESS_HEADER,
} from '../src/http/rate-limit.js';

describe('privacy-preserving rate limit keys', () => {
  it('uses keyed stable subjects without retaining a client address', () => {
    const pepper = 'p'.repeat(48);
    const request = new Request('https://api.example.com/', {
      headers: { [TRUSTED_CLIENT_ADDRESS_HEADER]: '192.0.2.44' },
    });
    const subject = createRateLimitSubject({
      environment: {},
      pepper,
      request,
    });
    const repeated = createRateLimitSubject({
      environment: {},
      pepper,
      request,
    });

    expect(subject).toBe(repeated);
    expect(subject).toMatch(/^[a-f0-9]{64}$/u);
    expect(subject).not.toContain('192.0.2.44');
  });

  it('creates fixed windows with bounded expiry and scoped keys', () => {
    const first = createRateLimitBucket({
      keyParts: ['client', 'flow'],
      limit: 12,
      now: new Date('2026-08-20T00:09:59.000Z'),
      pepper: 'p'.repeat(48),
      scope: 'exchange',
      windowSeconds: 600,
    });
    const second = createRateLimitBucket({
      keyParts: ['client', 'flow'],
      limit: 12,
      now: new Date('2026-08-20T00:10:00.000Z'),
      pepper: 'p'.repeat(48),
      scope: 'exchange',
      windowSeconds: 600,
    });

    expect(first.windowStartedAt).toBe('2026-08-20T00:00:00.000Z');
    expect(first.expiresAt).toBe('2026-08-20T00:20:00.000Z');
    expect(second.windowStartedAt).toBe('2026-08-20T00:10:00.000Z');
    expect(second.key).toBe(first.key);
  });
});
