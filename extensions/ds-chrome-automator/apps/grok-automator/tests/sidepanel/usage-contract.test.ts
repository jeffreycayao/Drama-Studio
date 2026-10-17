import {
  usageReservationCancelRequestSchema as sharedCancelSchema,
  usageReservationConsumeRequestSchema as sharedConsumeSchema,
  usageReservationRequestSchema as sharedRequestSchema,
  usageReservationResponseSchema as sharedResponseSchema,
  usageReservationTransitionResponseSchema as sharedTransitionSchema,
} from '@faceless-automations/platform-contracts';
import { describe, expect, it } from 'vitest';

import {
  legacyUsageAuthorizationRequestSchema,
  legacyUsageAuthorizationResponseSchema,
  usageReservationCancelRequestSchema,
  usageReservationConsumeRequestSchema,
  usageReservationRequestSchema,
  usageReservationResponseSchema,
  usageReservationTransitionResponseSchema,
} from '../../src/sidepanel/usage-contract';

function expectParity(
  local: { safeParse: (value: unknown) => { success: boolean } },
  shared: { safeParse: (value: unknown) => { success: boolean } },
  cases: readonly unknown[],
): void {
  for (const value of cases) {
    expect(local.safeParse(value).success).toBe(
      shared.safeParse(value).success,
    );
  }
}

describe('browser-safe usage reservation contract', () => {
  it('matches v2 reservation and transition request boundaries', () => {
    const reservation = {
      schemaVersion: 2,
      appId: 'grok-automator',
      operation: 'automation.run',
      units: 3,
      idempotencyKey: 'run.1234567890abcdef',
    };
    const consume = {
      schemaVersion: 2,
      acceptanceId: 'run.1234567890abcdef',
    };
    const cancel = { schemaVersion: 2 };
    expectParity(usageReservationRequestSchema, sharedRequestSchema, [
      reservation,
      { ...reservation, schemaVersion: 1 },
      { ...reservation, units: 0 },
      { ...reservation, idempotencyKey: 'short' },
      { ...reservation, planCode: 'client-authored' },
    ]);
    expectParity(usageReservationConsumeRequestSchema, sharedConsumeSchema, [
      consume,
      { ...consume, acceptanceId: 'short' },
      { ...consume, units: 1 },
    ]);
    expectParity(usageReservationCancelRequestSchema, sharedCancelSchema, [
      cancel,
      { schemaVersion: 1 },
      { ...cancel, acceptanceId: consume.acceptanceId },
    ]);
  });

  it('matches v2 reservation and transition response boundaries', () => {
    const reserved = {
      schemaVersion: 2,
      allowed: true,
      status: 'reserved',
      appId: 'grok-automator',
      operation: 'automation.run',
      authorizationId: 'authorization_1234567890',
      authorizedUnits: 3,
      remainingUnits: 97,
      expiresAt: '2026-08-16T00:01:00.000Z',
    };
    const denied = {
      schemaVersion: 2,
      allowed: false,
      status: 'denied',
      appId: 'grok-automator',
      operation: 'automation.run',
      reason: 'entitlement_required',
    };
    const transition = {
      schemaVersion: 2,
      appId: 'grok-automator',
      operation: 'automation.run',
      authorizationId: 'authorization_1234567890',
      status: 'consumed',
      finalizedAt: '2026-08-16T00:00:10.000Z',
    };
    expectParity(usageReservationResponseSchema, sharedResponseSchema, [
      reserved,
      denied,
      { ...reserved, authorizedUnits: 0 },
      { ...reserved, status: 'authorized' },
      { ...denied, reason: 'client_decides' },
    ]);
    expectParity(
      usageReservationTransitionResponseSchema,
      sharedTransitionSchema,
      [
        transition,
        { ...transition, status: 'reserved' },
        { ...transition, acceptanceId: 'client-authored' },
      ],
    );
  });

  it('keeps the legacy immediate-authorization contract strict and versionless', () => {
    const request = {
      appId: 'grok-automator',
      operation: 'automation.run',
      units: 3,
      idempotencyKey: 'run.1234567890abcdef',
    };
    const response = {
      allowed: true,
      appId: 'grok-automator',
      operation: 'automation.run',
      authorizationId: 'authorization_1234567890',
      authorizedUnits: 3,
      remainingUnits: 97,
    };

    expect(
      legacyUsageAuthorizationRequestSchema.safeParse(request).success,
    ).toBe(true);
    expect(
      legacyUsageAuthorizationResponseSchema.safeParse(response).success,
    ).toBe(true);
    expect(
      legacyUsageAuthorizationRequestSchema.safeParse({
        ...request,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      legacyUsageAuthorizationResponseSchema.safeParse({
        ...response,
        status: 'consumed',
      }).success,
    ).toBe(false);
  });
});
