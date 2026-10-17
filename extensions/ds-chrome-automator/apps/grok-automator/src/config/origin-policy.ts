function parseIpv4(
  hostname: string,
): readonly [number, number, number, number] | null {
  const segments = hostname.split('.');
  if (segments.length !== 4) return null;

  const octets = segments.map((segment) => Number(segment));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== segments[index],
    )
  ) {
    return null;
  }
  return octets as [number, number, number, number];
}

/**
 * Returns true only for loopback or private-network hosts that are acceptable
 * in an explicitly non-production build. Hostnames such as `my-machine.local`
 * are intentionally excluded because DNS could resolve them outside the LAN.
 */
export function isPrivateDevelopmentHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === '[::1]') return true;

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    const ipv6 = normalized.slice(1, -1);
    return (
      ipv6.startsWith('fc') ||
      ipv6.startsWith('fd') ||
      ipv6.startsWith('fe8') ||
      ipv6.startsWith('fe9') ||
      ipv6.startsWith('fea') ||
      ipv6.startsWith('feb')
    );
  }

  const ipv4 = parseIpv4(normalized);
  if (!ipv4) return false;
  const [first, second] = ipv4;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export interface NormalizeOwnedOriginOptions {
  readonly allowInsecurePrivateDevelopment?: boolean;
}

/**
 * Normalizes an origin-only value. HTTPS is accepted in every environment;
 * HTTP is accepted only for exact loopback/private hosts when the caller has
 * explicitly enabled the development-only exception.
 */
export function normalizeOwnedOrigin(
  value: unknown,
  options: NormalizeOwnedOriginOptions = {},
): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const isSecure = url.protocol === 'https:';
    const isPrivateDevelopment =
      options.allowInsecurePrivateDevelopment === true &&
      url.protocol === 'http:' &&
      isPrivateDevelopmentHost(url.hostname);
    const isOriginOnly =
      (url.pathname === '/' || url.pathname === '') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;

    if ((!isSecure && !isPrivateDevelopment) || !isOriginOnly) return null;
    return url.origin;
  } catch {
    return null;
  }
}
