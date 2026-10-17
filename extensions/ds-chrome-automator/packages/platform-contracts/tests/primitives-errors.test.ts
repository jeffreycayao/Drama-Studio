import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  appIdSchema,
  chromeExtensionOriginSchema,
  httpsUrlSchema,
  isoDateTimeSchema,
  semanticVersionSchema,
} from '../src/index.js';

describe('platform primitives', () => {
  it('accepts stable app IDs and semantic versions', () => {
    expect(appIdSchema.parse('grok-automator')).toBe('grok-automator');
    expect(semanticVersionSchema.parse('2.7.1-beta.1+build.9')).toBe(
      '2.7.1-beta.1+build.9',
    );
  });

  it('rejects malformed app IDs and extension origins', () => {
    expect(appIdSchema.safeParse('Grok_Automator').success).toBe(false);
    expect(appIdSchema.safeParse('grok-').success).toBe(false);
    expect(
      chromeExtensionOriginSchema.safeParse(
        'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ).success,
    ).toBe(true);
    expect(
      chromeExtensionOriginSchema.safeParse('https://example.com').success,
    ).toBe(false);
  });

  it('requires secure URLs without credentials or fragments', () => {
    expect(
      httpsUrlSchema.safeParse('https://auth.example.com/start').success,
    ).toBe(true);
    expect(
      httpsUrlSchema.safeParse('http://auth.example.com/start').success,
    ).toBe(false);
    expect(
      httpsUrlSchema.safeParse('https://user:pass@example.com/start').success,
    ).toBe(false);
    expect(
      httpsUrlSchema.safeParse('https://auth.example.com/start#token').success,
    ).toBe(false);
    expect(httpsUrlSchema.safeParse('not-a-url').success).toBe(false);
  });

  it('rejects impossible or timezone-free timestamps', () => {
    expect(
      isoDateTimeSchema.safeParse('2026-08-14T08:00:00+08:00').success,
    ).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-02-30T00:00:00Z').success).toBe(
      false,
    );
    expect(isoDateTimeSchema.safeParse('2026-08-14T00:00:00').success).toBe(
      false,
    );
  });
});

describe('API error envelope', () => {
  const validEnvelope = {
    error: {
      code: 'rate_limited',
      message: 'Try again later.',
      requestId: 'request_12345678',
      retryAfterSeconds: 30,
    },
  };

  it('accepts the bounded stable envelope', () => {
    expect(apiErrorEnvelopeSchema.parse(validEnvelope)).toEqual(validEnvelope);
    expect(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: 'upgrade_required',
          message: 'Two-phase usage reservations are required.',
          requestId: 'request_12345678',
        },
      }).error.code,
    ).toBe('upgrade_required');
  });

  it('rejects unknown fields and unbounded messages', () => {
    expect(
      apiErrorEnvelopeSchema.safeParse({
        ...validEnvelope,
        stack: 'must not leak',
      }).success,
    ).toBe(false);
    expect(
      apiErrorEnvelopeSchema.safeParse({
        error: { ...validEnvelope.error, message: 'x'.repeat(257) },
      }).success,
    ).toBe(false);
  });
});
