import {
  normalizeOwnedOrigin,
  type NormalizeOwnedOriginOptions,
} from './origin-policy';

export const PLATFORM_CLIENT_ID = 'grok-automator';

export const GOOGLE_SIGN_IN_UNAVAILABLE_MESSAGE =
  'Google sign-in is not configured yet. Grok Automator™ remains available in free mode.';

export function normalizePlatformWebOrigin(
  value: unknown,
  options: NormalizeOwnedOriginOptions = {},
): string | null {
  return normalizeOwnedOrigin(value, options);
}

export function createPlatformAuthUrl(
  value: unknown,
  options: NormalizeOwnedOriginOptions = {},
): string | null {
  const origin = normalizePlatformWebOrigin(value, options);
  if (!origin) return null;
  const url = new URL('/auth', origin);
  url.searchParams.set('client', PLATFORM_CLIENT_ID);
  return url.toString();
}
