import { describe, expect, it } from 'vitest';

import {
  usageAuthorizationRequestSchema,
  usageAuthorizationResponseSchema,
  usageReservationCancelRequestSchema,
  usageReservationConsumeRequestSchema,
  usageReservationFinalizeRequestSchema,
  usageReservationRequestSchema,
  usageReservationResponseSchema,
  usageReservationRollbackRequestSchema,
  usageReservationTransitionResponseSchema,
} from '../src/index.js';

describe('usage authorization contracts', () => {
  const request = {
    appId: 'grok-automator',
    operation: 'automation.run',
    units: 2,
    idempotencyKey: 'request.1234567890abcdef',
  };

  it('accepts a bounded idempotent request', () => {
    expect(usageAuthorizationRequestSchema.parse(request)).toEqual(request);
  });

  it('rejects excessive units and unknown client entitlement fields', () => {
    expect(
      usageAuthorizationRequestSchema.safeParse({
        ...request,
        units: 1_001,
      }).success,
    ).toBe(false);
    expect(
      usageAuthorizationRequestSchema.safeParse({
        ...request,
        isPro: true,
      }).success,
    ).toBe(false);
  });

  it('validates an allowed decision', () => {
    const response = {
      allowed: true,
      appId: 'grok-automator',
      operation: 'automation.run',
      authorizationId: 'usage_1234567890abcdef',
      authorizedUnits: 2,
      remainingUnits: 98,
      resetsAt: '2026-08-15T00:00:00.000Z',
    };

    expect(usageAuthorizationResponseSchema.parse(response)).toEqual(response);
  });

  it('validates a denied decision and rejects mixed response shapes', () => {
    const denied = {
      allowed: false,
      appId: 'grok-automator',
      operation: 'automation.run',
      reason: 'quota_exhausted',
      remainingUnits: 0,
    };

    expect(usageAuthorizationResponseSchema.parse(denied)).toEqual(denied);
    expect(
      usageAuthorizationResponseSchema.safeParse({
        ...denied,
        authorizationId: 'usage_1234567890abcdef',
      }).success,
    ).toBe(false);
  });

  it('versions a bounded two-phase reservation request', () => {
    const reservation = { ...request, schemaVersion: 2 as const };
    expect(usageReservationRequestSchema.parse(reservation)).toEqual(
      reservation,
    );
    expect(usageReservationRequestSchema.safeParse(request).success).toBe(
      false,
    );
  });

  it('validates reserve, consume, and cancel lifecycle messages', () => {
    expect(
      usageReservationResponseSchema.parse({
        allowed: true,
        appId: 'grok-automator',
        operation: 'automation.run',
        authorizationId: 'usage_1234567890abcdef',
        authorizedUnits: 2,
        remainingUnits: 98,
        resetsAt: '2026-08-15T00:00:00.000Z',
        expiresAt: '2026-08-14T23:01:00.000Z',
        schemaVersion: 2,
        status: 'reserved',
      }),
    ).toMatchObject({ status: 'reserved' });
    expect(
      usageReservationConsumeRequestSchema.parse({
        acceptanceId: 'queue.1234567890abcdef',
        schemaVersion: 2,
      }),
    ).toEqual({
      acceptanceId: 'queue.1234567890abcdef',
      schemaVersion: 2,
    });
    expect(
      usageReservationCancelRequestSchema.parse({ schemaVersion: 2 }),
    ).toEqual({ schemaVersion: 2 });
    expect(
      usageReservationResponseSchema.parse({
        allowed: true,
        appId: 'grok-automator',
        operation: 'automation.run',
        authorizationId: 'usage_1234567890abcdef',
        authorizedUnits: 2,
        remainingUnits: 98,
        resetsAt: '2026-08-15T00:00:00.000Z',
        acceptanceId: 'queue.1234567890abcdef',
        finalizeBy: '2026-08-14T23:01:00.000Z',
        schemaVersion: 2,
        status: 'accepted',
      }),
    ).toMatchObject({ status: 'accepted' });
    expect(
      usageReservationFinalizeRequestSchema.parse({
        acceptanceId: 'queue.1234567890abcdef',
        schemaVersion: 2,
      }),
    ).toMatchObject({ schemaVersion: 2 });
    expect(
      usageReservationRollbackRequestSchema.parse({
        acceptanceId: 'queue.1234567890abcdef',
        schemaVersion: 2,
      }),
    ).toMatchObject({ schemaVersion: 2 });
    expect(
      usageReservationTransitionResponseSchema.parse({
        acceptanceId: 'queue.1234567890abcdef',
        appId: 'grok-automator',
        authorizationId: 'usage_1234567890abcdef',
        finalizedAt: '2026-08-14T23:00:01.000Z',
        operation: 'automation.run',
        schemaVersion: 2,
        status: 'consumed',
      }),
    ).toMatchObject({ status: 'consumed' });
    expect(
      usageReservationTransitionResponseSchema.parse({
        acceptanceId: 'queue.1234567890abcdef',
        appId: 'grok-automator',
        authorizationId: 'usage_1234567890abcdef',
        finalizedAt: '2026-08-14T23:00:01.000Z',
        operation: 'automation.run',
        schemaVersion: 2,
        status: 'rolled_back',
      }),
    ).toMatchObject({ status: 'rolled_back' });
  });
});
