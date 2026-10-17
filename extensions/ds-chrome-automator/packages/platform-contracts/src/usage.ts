import { z } from 'zod';

import {
  appIdSchema,
  capabilityIdSchema,
  idempotencyKeySchema,
  isoDateTimeSchema,
  opaqueIdSchema,
} from './primitives.js';

export const usageAuthorizationRequestSchema = z.strictObject({
  appId: appIdSchema,
  operation: capabilityIdSchema,
  units: z.number().int().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
});

export const usageDenialReasonSchema = z.enum([
  'entitlement_required',
  'quota_exhausted',
  'app_disabled',
  'operation_disabled',
]);

export const allowedUsageAuthorizationResponseSchema = z.strictObject({
  allowed: z.literal(true),
  appId: appIdSchema,
  operation: capabilityIdSchema,
  authorizationId: opaqueIdSchema,
  authorizedUnits: z.number().int().min(1).max(1_000),
  remainingUnits: z.number().int().min(0).max(1_000_000_000),
  resetsAt: isoDateTimeSchema.optional(),
});

export const deniedUsageAuthorizationResponseSchema = z.strictObject({
  allowed: z.literal(false),
  appId: appIdSchema,
  operation: capabilityIdSchema,
  reason: usageDenialReasonSchema,
  remainingUnits: z.number().int().min(0).max(1_000_000_000).optional(),
  resetsAt: isoDateTimeSchema.optional(),
});

export const usageAuthorizationResponseSchema = z.discriminatedUnion(
  'allowed',
  [
    allowedUsageAuthorizationResponseSchema,
    deniedUsageAuthorizationResponseSchema,
  ],
);

export const usageReservationProtocolVersionSchema = z.literal(2);

export const usageReservationRequestSchema =
  usageAuthorizationRequestSchema.extend({
    schemaVersion: usageReservationProtocolVersionSchema,
  });

export const usageReservationConsumeRequestSchema = z.strictObject({
  schemaVersion: usageReservationProtocolVersionSchema,
  acceptanceId: idempotencyKeySchema,
});

export const usageReservationCancelRequestSchema = z.strictObject({
  schemaVersion: usageReservationProtocolVersionSchema,
});

export const usageReservationFinalizeRequestSchema =
  usageReservationConsumeRequestSchema;

export const usageReservationRollbackRequestSchema =
  usageReservationConsumeRequestSchema;

export const usageReservationTerminalReasonSchema = z.enum([
  'reservation_cancelled',
  'reservation_expired',
  'reservation_rolled_back',
]);

const usageReservationBaseShape = {
  schemaVersion: usageReservationProtocolVersionSchema,
  appId: appIdSchema,
  operation: capabilityIdSchema,
  authorizationId: opaqueIdSchema,
  authorizedUnits: z.number().int().min(1).max(1_000),
  remainingUnits: z.number().int().min(0).max(1_000_000_000),
  resetsAt: isoDateTimeSchema.optional(),
};

export const reservedUsageReservationResponseSchema = z.strictObject({
  ...usageReservationBaseShape,
  allowed: z.literal(true),
  status: z.literal('reserved'),
  expiresAt: isoDateTimeSchema,
});

export const consumedUsageReservationResponseSchema = z.strictObject({
  ...usageReservationBaseShape,
  allowed: z.literal(true),
  status: z.literal('consumed'),
  finalizedAt: isoDateTimeSchema,
});

export const acceptedUsageReservationResponseSchema = z.strictObject({
  ...usageReservationBaseShape,
  allowed: z.literal(true),
  status: z.literal('accepted'),
  acceptanceId: idempotencyKeySchema,
  finalizeBy: isoDateTimeSchema,
});

export const deniedUsageReservationResponseSchema = z.strictObject({
  schemaVersion: usageReservationProtocolVersionSchema,
  allowed: z.literal(false),
  status: z.literal('denied'),
  appId: appIdSchema,
  operation: capabilityIdSchema,
  reason: usageDenialReasonSchema,
  remainingUnits: z.number().int().min(0).max(1_000_000_000).optional(),
  resetsAt: isoDateTimeSchema.optional(),
});

export const terminalUsageReservationResponseSchema = z.strictObject({
  ...usageReservationBaseShape,
  allowed: z.literal(false),
  status: z.enum(['cancelled', 'expired', 'rolled_back']),
  reason: usageReservationTerminalReasonSchema,
  finalizedAt: isoDateTimeSchema,
});

export const usageReservationResponseSchema = z.discriminatedUnion('status', [
  reservedUsageReservationResponseSchema,
  acceptedUsageReservationResponseSchema,
  consumedUsageReservationResponseSchema,
  deniedUsageReservationResponseSchema,
  terminalUsageReservationResponseSchema,
]);

const usageReservationTransitionBaseShape = {
  schemaVersion: usageReservationProtocolVersionSchema,
  appId: appIdSchema,
  operation: capabilityIdSchema,
  authorizationId: opaqueIdSchema,
};

export const acceptedUsageReservationTransitionResponseSchema = z.strictObject({
  ...usageReservationTransitionBaseShape,
  status: z.literal('accepted'),
  acceptanceId: idempotencyKeySchema,
  finalizeBy: isoDateTimeSchema,
});

export const finalizedUsageReservationTransitionResponseSchema = z.strictObject(
  {
    ...usageReservationTransitionBaseShape,
    status: z.literal('consumed'),
    acceptanceId: idempotencyKeySchema,
    finalizedAt: isoDateTimeSchema,
  },
);

export const cancelledUsageReservationTransitionResponseSchema = z.strictObject(
  {
    ...usageReservationTransitionBaseShape,
    status: z.literal('cancelled'),
    finalizedAt: isoDateTimeSchema,
  },
);

export const rolledBackUsageReservationTransitionResponseSchema =
  z.strictObject({
    ...usageReservationTransitionBaseShape,
    status: z.literal('rolled_back'),
    acceptanceId: idempotencyKeySchema,
    finalizedAt: isoDateTimeSchema,
  });

export const usageReservationTransitionResponseSchema = z.discriminatedUnion(
  'status',
  [
    acceptedUsageReservationTransitionResponseSchema,
    finalizedUsageReservationTransitionResponseSchema,
    cancelledUsageReservationTransitionResponseSchema,
    rolledBackUsageReservationTransitionResponseSchema,
  ],
);

export type UsageAuthorizationRequest = z.infer<
  typeof usageAuthorizationRequestSchema
>;
export type UsageDenialReason = z.infer<typeof usageDenialReasonSchema>;
export type UsageAuthorizationResponse = z.infer<
  typeof usageAuthorizationResponseSchema
>;
export type UsageReservationRequest = z.infer<
  typeof usageReservationRequestSchema
>;
export type UsageReservationResponse = z.infer<
  typeof usageReservationResponseSchema
>;
export type UsageReservationTransitionResponse = z.infer<
  typeof usageReservationTransitionResponseSchema
>;
