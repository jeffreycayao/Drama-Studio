export const DEPLOYED_PLATFORM_WEB_ORIGIN = 'https://paks-tools.vercel.app';

export const DEPLOYED_GROK_AUTOMATOR_GUIDE_URL = `${DEPLOYED_PLATFORM_WEB_ORIGIN}/guide/grok-automator`;

export const DEPLOYED_PLATFORM_API_ORIGIN = 'https://paks-api.vercel.app';

export function configuredOriginOrDefault(
  value: unknown,
  defaultOrigin: string,
): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : defaultOrigin;
}
