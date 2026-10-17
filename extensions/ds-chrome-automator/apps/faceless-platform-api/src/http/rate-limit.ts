import { isIP } from 'node:net';

import { createPrivacyKey } from '../core/crypto.js';
import type { RateLimitBucket } from '../ports/database.js';

export const TRUSTED_CLIENT_ADDRESS_HEADER = 'x-faceless-client-address';

function normalizeAddress(value: string | null): string | null {
  if (value === null) return null;
  const candidate = value
    .trim()
    .replace(/^\[|\]$/gu, '')
    .toLowerCase();
  return isIP(candidate) === 0 ? null : candidate;
}

export function resolveClientAddress(
  request: Request,
  environment: NodeJS.ProcessEnv,
): string {
  if (environment.VERCEL === '1') {
    const forwarded = request.headers
      .get('x-forwarded-for')
      ?.split(',')[0]
      ?.trim();
    const normalized = normalizeAddress(forwarded ?? null);
    if (normalized !== null) return normalized;
  }
  return (
    normalizeAddress(request.headers.get(TRUSTED_CLIENT_ADDRESS_HEADER)) ??
    'unavailable'
  );
}

export function createRateLimitSubject(input: {
  environment: NodeJS.ProcessEnv;
  pepper: string;
  request: Request;
}): string {
  return createPrivacyKey(input.pepper, 'client-address', [
    resolveClientAddress(input.request, input.environment),
  ]);
}

export function createRateLimitBucket(input: {
  keyParts: readonly string[];
  limit: number;
  now: Date;
  pepper: string;
  scope: string;
  windowSeconds: number;
}): RateLimitBucket {
  const windowMilliseconds = input.windowSeconds * 1_000;
  const windowStartedAt = new Date(
    Math.floor(input.now.getTime() / windowMilliseconds) * windowMilliseconds,
  );
  return {
    expiresAt: new Date(
      windowStartedAt.getTime() + windowMilliseconds * 2,
    ).toISOString(),
    key: createPrivacyKey(input.pepper, `rate-${input.scope}`, input.keyParts),
    limit: input.limit,
    windowStartedAt: windowStartedAt.toISOString(),
  };
}
