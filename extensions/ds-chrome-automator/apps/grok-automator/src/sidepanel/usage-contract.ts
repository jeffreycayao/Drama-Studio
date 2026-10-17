import type {
  UsageReservationRequest,
  UsageReservationResponse,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod/mini';

const lowerKebabPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const capabilityPattern = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/u;
const opaqueIdentifierPattern = /^[A-Za-z0-9_-]+$/u;

const appIdSchema = z
  .string()
  .check(z.minLength(3), z.maxLength(63), z.regex(lowerKebabPattern));
const capabilityIdSchema = z
  .string()
  .check(z.minLength(3), z.maxLength(128), z.regex(capabilityPattern));
const idempotencyKeySchema = z
  .string()
  .check(z.minLength(16), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));
const opaqueIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(128), z.regex(opaqueIdentifierPattern));
const isoDateTimeSchema = z.iso
  .datetime({ offset: true })
  .check(z.minLength(20), z.maxLength(35));
const unitsSchema = z.number().check(z.int(), z.minimum(1), z.maximum(1_000));
const remainingUnitsSchema = z
  .number()
  .check(z.int(), z.minimum(0), z.maximum(1_000_000_000));

export const usageReservationRequestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  appId: appIdSchema,
  operation: capabilityIdSchema,
  units: unitsSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const legacyUsageAuthorizationRequestSchema = z.strictObject({
  appId: appIdSchema,
  operation: capabilityIdSchema,
  units: unitsSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const usageReservationConsumeRequestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  acceptanceId: idempotencyKeySchema,
});

export const usageReservationCancelRequestSchema = z.strictObject({
  schemaVersion: z.literal(2),
});

const usageDenialReasonSchema = z.enum([
  'entitlement_required',
  'quota_exhausted',
  'app_disabled',
  'operation_disabled',
]);

const reservationBase = {
  schemaVersion: z.literal(2),
  appId: appIdSchema,
  operation: capabilityIdSchema,
  authorizationId: opaqueIdSchema,
  authorizedUnits: unitsSchema,
  remainingUnits: remainingUnitsSchema,
  resetsAt: z.optional(isoDateTimeSchema),
};

const reservedUsageReservationResponseSchema = z.strictObject({
  ...reservationBase,
  allowed: z.literal(true),
  status: z.literal('reserved'),
  expiresAt: isoDateTimeSchema,
});

const consumedUsageReservationResponseSchema = z.strictObject({
  ...reservationBase,
  allowed: z.literal(true),
  status: z.literal('consumed'),
  finalizedAt: isoDateTimeSchema,
});

const deniedUsageReservationResponseSchema = z.strictObject({
  schemaVersion: z.literal(2),
  allowed: z.literal(false),
  status: z.literal('denied'),
  appId: appIdSchema,
  operation: capabilityIdSchema,
  reason: usageDenialReasonSchema,
  remainingUnits: z.optional(remainingUnitsSchema),
  resetsAt: z.optional(isoDateTimeSchema),
});

const terminalUsageReservationResponseSchema = z.strictObject({
  ...reservationBase,
  allowed: z.literal(false),
  status: z.enum(['cancelled', 'expired']),
  reason: z.enum(['reservation_cancelled', 'reservation_expired']),
  finalizedAt: isoDateTimeSchema,
});

export const usageReservationResponseSchema = z.discriminatedUnion('status', [
  reservedUsageReservationResponseSchema,
  consumedUsageReservationResponseSchema,
  deniedUsageReservationResponseSchema,
  terminalUsageReservationResponseSchema,
]);

const usageTransitionBase = {
  schemaVersion: z.literal(2),
  appId: appIdSchema,
  operation: capabilityIdSchema,
  authorizationId: opaqueIdSchema,
};

const acceptedUsageReservationTransitionResponseSchema = z.strictObject({
  ...usageTransitionBase,
  status: z.literal('accepted'),
  acceptanceId: idempotencyKeySchema,
  finalizeBy: isoDateTimeSchema,
});

const finalizedUsageReservationTransitionResponseSchema = z.strictObject({
  ...usageTransitionBase,
  status: z.enum(['consumed', 'rolled_back']),
  acceptanceId: idempotencyKeySchema,
  finalizedAt: isoDateTimeSchema,
});

const cancelledUsageReservationTransitionResponseSchema = z.strictObject({
  ...usageTransitionBase,
  status: z.literal('cancelled'),
  finalizedAt: isoDateTimeSchema,
});

export const usageReservationTransitionResponseSchema = z.discriminatedUnion(
  'status',
  [
    acceptedUsageReservationTransitionResponseSchema,
    finalizedUsageReservationTransitionResponseSchema,
    cancelledUsageReservationTransitionResponseSchema,
  ],
);

const legacyUsageAuthorizationBase = {
  appId: appIdSchema,
  operation: capabilityIdSchema,
};

const legacyAllowedUsageAuthorizationResponseSchema = z.strictObject({
  ...legacyUsageAuthorizationBase,
  allowed: z.literal(true),
  authorizationId: opaqueIdSchema,
  authorizedUnits: unitsSchema,
  remainingUnits: remainingUnitsSchema,
  resetsAt: z.optional(isoDateTimeSchema),
});

const legacyDeniedUsageAuthorizationResponseSchema = z.strictObject({
  ...legacyUsageAuthorizationBase,
  allowed: z.literal(false),
  reason: usageDenialReasonSchema,
  remainingUnits: z.optional(remainingUnitsSchema),
  resetsAt: z.optional(isoDateTimeSchema),
});

export const legacyUsageAuthorizationResponseSchema = z.discriminatedUnion(
  'allowed',
  [
    legacyAllowedUsageAuthorizationResponseSchema,
    legacyDeniedUsageAuthorizationResponseSchema,
  ],
);

export const protocolUnavailableErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal('upgrade_required'),
    message: z.string().check(z.minLength(1), z.maxLength(500)),
    requestId: z
      .string()
      .check(z.minLength(1), z.maxLength(128), z.regex(/^[A-Za-z0-9_-]+$/u)),
    retryAfterSeconds: z.optional(
      z.number().check(z.int(), z.minimum(0), z.maximum(86_400)),
    ),
  }),
});

export function parseUsageReservationRequest(
  value: unknown,
): UsageReservationRequest {
  return usageReservationRequestSchema.parse(value);
}

export function parseLegacyUsageAuthorizationRequest(
  value: unknown,
): z.infer<typeof legacyUsageAuthorizationRequestSchema> {
  return legacyUsageAuthorizationRequestSchema.parse(value);
}

export function parseLegacyUsageAuthorizationResponse(
  value: unknown,
): z.infer<typeof legacyUsageAuthorizationResponseSchema> {
  return legacyUsageAuthorizationResponseSchema.parse(value);
}

export function parseUsageReservationResponse(
  value: unknown,
): UsageReservationResponse {
  return usageReservationResponseSchema.parse(value);
}

export function parseUsageReservationConsumeRequest(value: unknown): {
  schemaVersion: 2;
  acceptanceId: string;
} {
  return usageReservationConsumeRequestSchema.parse(value);
}

export function parseUsageReservationCancelRequest(value: unknown): {
  schemaVersion: 2;
} {
  return usageReservationCancelRequestSchema.parse(value);
}

export function parseUsageReservationTransitionResponse(
  value: unknown,
): z.infer<typeof usageReservationTransitionResponseSchema> {
  return usageReservationTransitionResponseSchema.parse(value);
}
