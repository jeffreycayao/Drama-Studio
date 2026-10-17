import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { reconcileInFlightRunCommits } from '../../src/sidepanel/run-commit-recovery';
import {
  loadInFlightRunCommits,
  saveInFlightRunCommit,
  type InFlightRunCommit,
} from '../../src/sidepanel/storage';
import type {
  LegacyRunAuthorizationDecision,
  ReservationTransitionDecision,
} from '../../src/sidepanel/usage-authorization';

function reservationRecovery(): Extract<
  InFlightRunCommit,
  { lifecycle: 'reservation' }
> {
  return {
    lifecycle: 'reservation',
    authorizationId: 'authorization_1234567890',
    acceptanceId: 'run.recovery_1234567890',
    groupId: 'group-recovery-123',
    tabId: 42,
    createdAt: Date.now(),
  };
}

function legacyRecovery(): Extract<
  InFlightRunCommit,
  { lifecycle: 'legacy-immediate' }
> {
  return {
    lifecycle: 'legacy-immediate',
    units: 2,
    acceptanceId: 'run.legacy_recovery_1234567890',
    groupId: 'group-legacy-recovery',
    tabId: 84,
    createdAt: Date.now(),
  };
}

function authorizer() {
  return {
    authorizeLegacyRun: vi.fn(
      async (): Promise<LegacyRunAuthorizationDecision> => ({
        status: 'consumed',
        authorizationId: 'legacy_authorization_1234567890',
        remainingUnits: 10,
        lifecycle: 'legacy-immediate',
      }),
    ),
    consumeReservation: vi.fn(
      async (): Promise<ReservationTransitionDecision> => ({
        status: 'accepted',
        finalizeBy: new Date(Date.now() + 30_000).toISOString(),
      }),
    ),
    finalizeReservation: vi.fn(
      async (): Promise<ReservationTransitionDecision> => ({
        status: 'consumed',
      }),
    ),
    rollbackReservation: vi.fn(
      async (): Promise<ReservationTransitionDecision> => ({
        status: 'rolled_back',
      }),
    ),
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('interrupted Run commit recovery', () => {
  it('resumes tentative consume, exact commit confirmation, and finalization after panel teardown', async () => {
    const recovery = reservationRecovery();
    await saveInFlightRunCommit(recovery);
    const usage = authorizer();
    const commit = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const query = vi
      .fn()
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('blocked')
      .mockResolvedValueOnce('released');

    await expect(
      reconcileInFlightRunCommits(usage, { commit, query, release }),
    ).resolves.toEqual({
      recoveredCount: 1,
      rolledBackCount: 0,
      unresolvedCount: 0,
    });

    expect(usage.consumeReservation).toHaveBeenCalledWith(
      recovery.authorizationId,
      recovery.acceptanceId,
    );
    expect(commit).toHaveBeenCalledWith(
      recovery.groupId,
      recovery.acceptanceId,
      recovery.tabId,
    );
    expect(usage.finalizeReservation).toHaveBeenCalledWith(
      recovery.authorizationId,
      recovery.acceptanceId,
    );
    expect(release).toHaveBeenCalledWith(
      recovery.groupId,
      recovery.acceptanceId,
      recovery.tabId,
    );
    await expect(loadInFlightRunCommits()).resolves.toEqual([]);
  });

  it('rolls back without consuming when content reload erased the staged group', async () => {
    const recovery = reservationRecovery();
    await saveInFlightRunCommit(recovery);
    const usage = authorizer();

    await expect(
      reconcileInFlightRunCommits(usage, {
        query: async () => 'missing',
      }),
    ).resolves.toEqual({
      recoveredCount: 0,
      rolledBackCount: 1,
      unresolvedCount: 0,
    });

    expect(usage.consumeReservation).not.toHaveBeenCalled();
    expect(usage.rollbackReservation).toHaveBeenCalledWith(
      recovery.authorizationId,
      recovery.acceptanceId,
    );
    await expect(loadInFlightRunCommits()).resolves.toEqual([]);
  });

  it('retains metadata and does not commit when tentative consume remains ambiguous', async () => {
    const recovery = reservationRecovery();
    await saveInFlightRunCommit(recovery);
    const usage = authorizer();
    usage.consumeReservation.mockResolvedValue({
      status: 'unavailable',
      message: 'The license service could not authorize this Run.',
    });
    const commit = vi.fn(async () => undefined);

    await expect(
      reconcileInFlightRunCommits(usage, {
        query: async () => 'pending',
        commit,
      }),
    ).resolves.toEqual({
      recoveredCount: 0,
      rolledBackCount: 0,
      unresolvedCount: 1,
    });

    expect(commit).not.toHaveBeenCalled();
    await expect(loadInFlightRunCommits()).resolves.toEqual([recovery]);
  });

  it('keeps a blocked group inert and retries a lost finalize response before release', async () => {
    const recovery = reservationRecovery();
    await saveInFlightRunCommit(recovery);
    const usage = authorizer();
    usage.finalizeReservation.mockResolvedValueOnce({
      status: 'unavailable',
      message: 'The license service could not authorize this Run.',
    });
    const commit = vi.fn(async () => undefined);
    let localStatus: 'blocked' | 'released' = 'blocked';
    const query = vi.fn(async () => localStatus);
    const release = vi.fn(async () => {
      localStatus = 'released';
    });

    await expect(
      reconcileInFlightRunCommits(usage, { commit, query, release }),
    ).resolves.toMatchObject({ recoveredCount: 0, unresolvedCount: 1 });
    expect(commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    const retained = await loadInFlightRunCommits();
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({
      lifecycle: 'reservation',
      groupId: recovery.groupId,
      acceptanceId: recovery.acceptanceId,
    });
    expect(
      retained[0]?.lifecycle === 'reservation'
        ? retained[0].finalizeBy
        : undefined,
    ).toBeTypeOf('string');

    usage.finalizeReservation.mockResolvedValue({ status: 'consumed' });
    await expect(
      reconcileInFlightRunCommits(usage, { commit, query, release }),
    ).resolves.toMatchObject({ recoveredCount: 1, unresolvedCount: 0 });
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    await expect(loadInFlightRunCommits()).resolves.toEqual([]);
  });

  it('replays legacy authorization idempotently only after confirming the inert local stage', async () => {
    const recovery = legacyRecovery();
    await saveInFlightRunCommit(recovery);
    const usage = authorizer();
    const commit = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const query = vi
      .fn()
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('blocked')
      .mockResolvedValueOnce('released');

    await expect(
      reconcileInFlightRunCommits(usage, { commit, query, release }),
    ).resolves.toMatchObject({ recoveredCount: 1, unresolvedCount: 0 });

    expect(usage.authorizeLegacyRun).toHaveBeenCalledWith(
      recovery.units,
      recovery.acceptanceId,
    );
    expect(usage.consumeReservation).not.toHaveBeenCalled();
    expect(usage.finalizeReservation).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    await expect(loadInFlightRunCommits()).resolves.toEqual([]);
  });
});
