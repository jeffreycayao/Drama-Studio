const GROK_HOSTNAME = 'grok.com';
const GENERATED_MEDIA_HOSTNAMES = new Set(['imgen.x.ai', 'vidgen.x.ai']);
const BASE64_RASTER_DATA_URL =
  /^data:(image\/(?:avif|bmp|gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
const VALID_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const MAX_BASE64_RASTER_BYTES = 25 * 1024 * 1024;

function parseStrictHttpsUrl(candidate: string): URL | null {
  if (!candidate || candidate.trim() !== candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== ''
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function isGrokHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return (
    normalized === GROK_HOSTNAME || normalized.endsWith(`.${GROK_HOSTNAME}`)
  );
}

export function isHttpsGrokUrl(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const url = parseStrictHttpsUrl(candidate);
  return url !== null && isGrokHostname(url.hostname);
}

export function isAllowedGeneratedHttpsUrl(candidate: string): boolean {
  const url = parseStrictHttpsUrl(candidate);
  return (
    url !== null &&
    (isGrokHostname(url.hostname) ||
      GENERATED_MEDIA_HOSTNAMES.has(
        url.hostname.toLowerCase().replace(/\.$/, ''),
      ))
  );
}

export function isBoundedBase64RasterDataUrl(
  candidate: string,
  maxBytes = MAX_BASE64_RASTER_BYTES,
): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return false;
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (candidate.length > maxEncodedLength + 64) return false;
  const match = BASE64_RASTER_DATA_URL.exec(candidate);
  const payload = match?.[2];
  if (!payload || !VALID_BASE64.test(payload)) return false;

  const paddingBytes = payload.endsWith('==')
    ? 2
    : payload.endsWith('=')
      ? 1
      : 0;
  const decodedBytes = (payload.length / 4) * 3 - paddingBytes;
  return decodedBytes <= maxBytes;
}

function isAllowedGeneratedBlobUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'blob:') return false;
    const innerUrl = candidate.slice(candidate.indexOf(':') + 1);
    return isAllowedGeneratedHttpsUrl(innerUrl);
  } catch {
    return false;
  }
}

export function isAllowedGeneratedResourceUrl(candidate: string): boolean {
  const separator = candidate.indexOf(':');
  const scheme =
    separator > 0 ? candidate.slice(0, separator).toLowerCase() : '';
  if (scheme === 'https') return isAllowedGeneratedHttpsUrl(candidate);
  if (scheme === 'data') return isBoundedBase64RasterDataUrl(candidate);
  if (scheme === 'blob') return isAllowedGeneratedBlobUrl(candidate);
  return false;
}
