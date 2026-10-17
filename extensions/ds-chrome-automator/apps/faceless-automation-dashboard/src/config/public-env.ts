import { z } from 'zod';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined) return false;

  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

const rawOriginSchema = z.string().trim().url();

export const DEFAULT_PLATFORM_API_ORIGIN = 'https://paks-tools.vercel.app';

export interface PublicOriginOptions {
  allowInsecureDevelopment?: boolean;
}

export function parsePlatformApiOrigin(
  rawOrigin: unknown,
  options: PublicOriginOptions = {},
): string | null {
  const parsed = rawOriginSchema.safeParse(rawOrigin);
  if (!parsed.success) return null;

  const url = new URL(parsed.data);
  const isOriginOnly =
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '';
  if (!isOriginOnly) return null;

  if (url.protocol === 'https:') return url.origin;

  const isApprovedDevelopmentHost =
    loopbackHosts.has(url.hostname) || isPrivateIpv4(url.hostname);
  if (
    options.allowInsecureDevelopment === true &&
    url.protocol === 'http:' &&
    isApprovedDevelopmentHost
  ) {
    return url.origin;
  }

  return null;
}

export function createGoogleAuthStartUrl(
  rawOrigin: unknown,
  options: PublicOriginOptions = {},
): string | null {
  const origin = parsePlatformApiOrigin(rawOrigin, options);
  if (origin === null) return null;

  const endpoint = new URL('/v1/auth/google/start', origin);
  endpoint.searchParams.set('client', 'dashboard');
  return endpoint.toString();
}

export function createExtensionGoogleAuthStartUrl(
  rawOrigin: unknown,
  flowId: string,
  options: PublicOriginOptions = {},
): string | null {
  const origin = parsePlatformApiOrigin(rawOrigin, options);
  if (origin === null || !/^[A-Za-z0-9_-]{8,128}$/u.test(flowId)) return null;

  const endpoint = new URL('/v1/auth/google/start', origin);
  endpoint.searchParams.set('client', 'extension');
  endpoint.searchParams.set('flowId', flowId);
  return endpoint.toString();
}

const configuredOrigin =
  import.meta.env.DEV && typeof window !== 'undefined'
    ? window.location.origin
    : (import.meta.env.VITE_PLATFORM_API_ORIGIN ??
      import.meta.env.VITE_AUTH_API_ORIGIN ??
      DEFAULT_PLATFORM_API_ORIGIN);

export const platformApiOrigin = parsePlatformApiOrigin(configuredOrigin, {
  allowInsecureDevelopment: import.meta.env.DEV,
});

export const googleAuthStartUrl = createGoogleAuthStartUrl(configuredOrigin, {
  allowInsecureDevelopment: import.meta.env.DEV,
});
