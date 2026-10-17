export const LEGACY_PROTOCOL_SUNSET_AT = '2026-11-30T00:00:00.000Z';

const legacyProtocolSunsetEpoch = Date.parse(LEGACY_PROTOCOL_SUNSET_AT);

export function isLegacyProtocolAvailable(now: Date): boolean {
  return now.getTime() < legacyProtocolSunsetEpoch;
}

export function markLegacyProtocolResponse(response: Response): Response {
  response.headers.set('Deprecation', 'true');
  response.headers.set(
    'Sunset',
    new Date(legacyProtocolSunsetEpoch).toUTCString(),
  );
  return response;
}
