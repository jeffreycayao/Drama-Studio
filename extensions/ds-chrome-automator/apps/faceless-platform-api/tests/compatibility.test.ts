import { describe, expect, it } from 'vitest';

import {
  isLegacyProtocolAvailable,
  LEGACY_PROTOCOL_SUNSET_AT,
  markLegacyProtocolResponse,
} from '../src/core/compatibility.js';

describe('legacy protocol compatibility window', () => {
  it('uses the release-verifiable UTC sunset as an exclusive boundary', () => {
    expect(LEGACY_PROTOCOL_SUNSET_AT).toBe('2026-11-30T00:00:00.000Z');
    expect(
      isLegacyProtocolAvailable(new Date('2026-11-29T23:59:59.999Z')),
    ).toBe(true);
    expect(isLegacyProtocolAvailable(new Date(LEGACY_PROTOCOL_SUNSET_AT))).toBe(
      false,
    );
  });

  it('marks every successful legacy response with deprecation metadata', () => {
    const response = markLegacyProtocolResponse(Response.json({ ok: true }));

    expect(response.headers.get('Deprecation')).toBe('true');
    expect(response.headers.get('Sunset')).toBe(
      'Mon, 30 Nov 2026 00:00:00 GMT',
    );
  });
});
