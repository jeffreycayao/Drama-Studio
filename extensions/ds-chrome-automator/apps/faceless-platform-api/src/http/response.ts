import {
  apiErrorEnvelopeSchema,
  type ApiErrorCode,
} from '@faceless-automations/platform-contracts';

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    headers: { 'Cache-Control': 'no-store' },
    status,
  });
}

export function errorResponse(input: {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  retryAfterSeconds?: number;
  status: number;
}): Response {
  const error = apiErrorEnvelopeSchema.parse({
    error: {
      code: input.code,
      message: input.message,
      requestId: input.requestId,
      ...(input.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: input.retryAfterSeconds }),
    },
  });
  const response = jsonResponse(error, input.status);
  if (input.retryAfterSeconds !== undefined) {
    response.headers.set('Retry-After', String(input.retryAfterSeconds));
  }
  return response;
}

export function applySecurityHeaders(
  response: Response,
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy', 'same-site');
  headers.set('X-Request-Id', requestId);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
