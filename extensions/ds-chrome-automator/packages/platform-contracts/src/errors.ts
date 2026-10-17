import { z } from 'zod';

import { requestIdSchema } from './primitives.js';

export const apiErrorCodeSchema = z.enum([
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'upgrade_required',
  'rate_limited',
  'auth_flow_pending',
  'auth_flow_denied',
  'auth_flow_expired',
  'auth_flow_consumed',
  'service_unavailable',
  'internal_error',
]);

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string().min(1).max(256),
  requestId: requestIdSchema,
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
});

export const apiErrorEnvelopeSchema = z.strictObject({
  error: apiErrorSchema,
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
