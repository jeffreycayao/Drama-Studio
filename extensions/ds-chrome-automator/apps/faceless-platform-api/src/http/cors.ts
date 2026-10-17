import type { PublicConfig } from '../config/env.js';
import { HttpError } from '../core/errors.js';

function isAdminPath(pathname: string): boolean {
  return pathname.startsWith('/v1/admin/');
}

function isExtensionOrigin(origin: string): boolean {
  return origin.startsWith('chrome-extension://');
}

export function assertAllowedOrigin(
  origin: string | null,
  pathname: string,
  config: PublicConfig,
): string | null {
  if (origin === null) return null;
  if (!config.allowedCorsOrigins.has(origin)) {
    throw new HttpError(403, 'forbidden', 'Origin is not allowed');
  }
  if (isAdminPath(pathname) && isExtensionOrigin(origin)) {
    throw new HttpError(403, 'forbidden', 'Origin is not allowed');
  }
  return origin;
}

export function applyCors(
  response: Response,
  allowedOrigin: string | null,
): Response {
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Origin');
  if (allowedOrigin !== null) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function createPreflightResponse(allowedOrigin: string): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Idempotency-Key, X-Faceless-CSRF',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
    status: 204,
  });
}
