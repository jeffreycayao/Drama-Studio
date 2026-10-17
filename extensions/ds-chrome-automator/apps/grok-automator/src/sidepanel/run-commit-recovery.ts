import {
  cancelPromptGroup,
  commitPromptGroup,
  queryPromptGroupCommitStatus,
  releasePromptGroup,
  type PromptGroupCommitStatus,
} from './protocol';
import {
  clearInFlightRunCommit,
  loadInFlightRunCommits,
  saveInFlightRunCommit,
  type InFlightRunCommit,
} from './storage';
import type { UsageAuthorizer } from './usage-authorization';

interface RunCommitRecoveryDependencies {
  load: () => Promise<InFlightRunCommit[]>;
  save: (recovery: InFlightRunCommit) => Promise<void>;
  clear: (recovery: InFlightRunCommit) => Promise<void>;
  query: (
    groupId: string,
    acceptanceId: string,
    tabId: number,
  ) => Promise<PromptGroupCommitStatus>;
  commit: (
    groupId: string,
    acceptanceId: string,
    tabId: number,
  ) => Promise<void>;
  release: (
    groupId: string,
    acceptanceId: string,
    tabId: number,
  ) => Promise<void>;
  cancel: (
    groupId: string,
    tabId: number,
    acceptanceId: string,
  ) => Promise<void>;
  onRecovered: (recovery: InFlightRunCommit) => void;
  onRolledBack: (recovery: InFlightRunCommit) => void;
  onError: (error: unknown) => void;
}

export interface RunCommitRecoveryResult {
  recoveredCount: number;
  rolledBackCount: number;
  unresolvedCount: number;
}

type RecoveryOutcome = 'recovered' | 'rolled_back' | 'unresolved';
type RecoveryAuthorizer = Pick<
  UsageAuthorizer,
  | 'authorizeLegacyRun'
  | 'consumeReservation'
  | 'finalizeReservation'
  | 'rollbackReservation'
>;

async function ensureLocalStage(
  recovery: InFlightRunCommit,
  initialStatus: PromptGroupCommitStatus,
  dependencies: RunCommitRecoveryDependencies,
): Promise<PromptGroupCommitStatus> {
  if (initialStatus === 'pending') {
    await dependencies.commit(
      recovery.groupId,
      recovery.acceptanceId,
      recovery.tabId,
    );
  }
  return dependencies.query(
    recovery.groupId,
    recovery.acceptanceId,
    recovery.tabId,
  );
}

async function rollbackReservationAndLocalGroup(
  recovery: Extract<InFlightRunCommit, { lifecycle: 'reservation' }>,
  usageAuthorizer: RecoveryAuthorizer,
  dependencies: RunCommitRecoveryDependencies,
  localStatus: PromptGroupCommitStatus,
): Promise<RecoveryOutcome> {
  const rollback = await usageAuthorizer.rollbackReservation(
    recovery.authorizationId,
    recovery.acceptanceId,
  );
  if (rollback.status !== 'rolled_back') return 'unresolved';
  if (localStatus !== 'missing') {
    await dependencies
      .cancel(recovery.groupId, recovery.tabId, recovery.acceptanceId)
      .catch(() => undefined);
  }
  await dependencies.clear(recovery);
  dependencies.onRolledBack(recovery);
  return 'rolled_back';
}

async function recoverReservationLifecycle(
  recovery: Extract<InFlightRunCommit, { lifecycle: 'reservation' }>,
  usageAuthorizer: RecoveryAuthorizer,
  dependencies: RunCommitRecoveryDependencies,
): Promise<RecoveryOutcome> {
  let activeRecovery = recovery;
  let localStatus = await dependencies.query(
    recovery.groupId,
    recovery.acceptanceId,
    recovery.tabId,
  );
  if (localStatus === 'missing') {
    return rollbackReservationAndLocalGroup(
      recovery,
      usageAuthorizer,
      dependencies,
      localStatus,
    );
  }

  const acceptance = await usageAuthorizer.consumeReservation(
    recovery.authorizationId,
    recovery.acceptanceId,
  );
  if (acceptance.status === 'rolled_back') {
    await dependencies
      .cancel(recovery.groupId, recovery.tabId, recovery.acceptanceId)
      .catch(() => undefined);
    await dependencies.clear(recovery);
    dependencies.onRolledBack(recovery);
    return 'rolled_back';
  }
  if (acceptance.status !== 'accepted' && acceptance.status !== 'consumed') {
    return 'unresolved';
  }
  if (
    acceptance.status === 'accepted' &&
    activeRecovery.finalizeBy !== acceptance.finalizeBy
  ) {
    activeRecovery = {
      ...activeRecovery,
      finalizeBy: acceptance.finalizeBy,
    };
    await dependencies.save(activeRecovery);
  }

  localStatus = await ensureLocalStage(
    activeRecovery,
    localStatus,
    dependencies,
  );
  if (
    localStatus !== 'blocked' &&
    localStatus !== 'released' &&
    localStatus !== 'claimed'
  ) {
    if (acceptance.status === 'accepted') {
      return rollbackReservationAndLocalGroup(
        activeRecovery,
        usageAuthorizer,
        dependencies,
        localStatus,
      );
    }
    return 'unresolved';
  }

  if (acceptance.status === 'accepted') {
    const finalized = await usageAuthorizer.finalizeReservation(
      activeRecovery.authorizationId,
      activeRecovery.acceptanceId,
    );
    if (finalized.status !== 'consumed') return 'unresolved';
  }
  if (localStatus !== 'released' && localStatus !== 'claimed') {
    await dependencies.release(
      activeRecovery.groupId,
      activeRecovery.acceptanceId,
      activeRecovery.tabId,
    );
    localStatus = await dependencies.query(
      activeRecovery.groupId,
      activeRecovery.acceptanceId,
      activeRecovery.tabId,
    );
  }
  if (localStatus !== 'released' && localStatus !== 'claimed')
    return 'unresolved';
  await dependencies.clear(activeRecovery);
  dependencies.onRecovered(activeRecovery);
  return 'recovered';
}

async function recoverLegacyLifecycle(
  recovery: Extract<InFlightRunCommit, { lifecycle: 'legacy-immediate' }>,
  usageAuthorizer: RecoveryAuthorizer,
  dependencies: RunCommitRecoveryDependencies,
): Promise<RecoveryOutcome> {
  let localStatus = await dependencies.query(
    recovery.groupId,
    recovery.acceptanceId,
    recovery.tabId,
  );
  if (localStatus === 'missing') {
    await dependencies.clear(recovery);
    dependencies.onRolledBack(recovery);
    return 'rolled_back';
  }

  localStatus = await ensureLocalStage(recovery, localStatus, dependencies);
  if (
    localStatus !== 'blocked' &&
    localStatus !== 'released' &&
    localStatus !== 'claimed'
  ) {
    return 'unresolved';
  }

  const authorization = await usageAuthorizer.authorizeLegacyRun(
    recovery.units,
    recovery.acceptanceId,
  );
  if (authorization.status === 'denied') {
    await dependencies
      .cancel(recovery.groupId, recovery.tabId, recovery.acceptanceId)
      .catch(() => undefined);
    await dependencies.clear(recovery);
    dependencies.onRolledBack(recovery);
    return 'rolled_back';
  }
  if (authorization.status !== 'consumed') return 'unresolved';
  if (
    recovery.authorizationId &&
    recovery.authorizationId !== authorization.authorizationId
  ) {
    throw new Error('Legacy authorization recovery did not match its Run');
  }
  const authorizedRecovery: InFlightRunCommit = {
    ...recovery,
    authorizationId: authorization.authorizationId,
  };
  await dependencies.save(authorizedRecovery);

  if (localStatus !== 'released' && localStatus !== 'claimed') {
    await dependencies.release(
      authorizedRecovery.groupId,
      authorizedRecovery.acceptanceId,
      authorizedRecovery.tabId,
    );
    localStatus = await dependencies.query(
      authorizedRecovery.groupId,
      authorizedRecovery.acceptanceId,
      authorizedRecovery.tabId,
    );
  }
  if (localStatus !== 'released' && localStatus !== 'claimed')
    return 'unresolved';
  await dependencies.clear(authorizedRecovery);
  dependencies.onRecovered(authorizedRecovery);
  return 'recovered';
}

export async function reconcileInFlightRunCommits(
  usageAuthorizer: RecoveryAuthorizer,
  overrides: Partial<RunCommitRecoveryDependencies> = {},
): Promise<RunCommitRecoveryResult> {
  const dependencies: RunCommitRecoveryDependencies = {
    load: loadInFlightRunCommits,
    save: (recovery) => saveInFlightRunCommit(recovery),
    clear: (recovery) => clearInFlightRunCommit(recovery),
    query: queryPromptGroupCommitStatus,
    commit: commitPromptGroup,
    release: releasePromptGroup,
    cancel: (groupId, tabId, acceptanceId) =>
      cancelPromptGroup(groupId, tabId, acceptanceId),
    onRecovered: () => undefined,
    onRolledBack: () => undefined,
    onError: () => undefined,
    ...overrides,
  };
  const recoveries = await dependencies.load();
  const result: RunCommitRecoveryResult = {
    recoveredCount: 0,
    rolledBackCount: 0,
    unresolvedCount: 0,
  };
  for (const recovery of recoveries) {
    try {
      const outcome =
        recovery.lifecycle === 'reservation'
          ? await recoverReservationLifecycle(
              recovery,
              usageAuthorizer,
              dependencies,
            )
          : await recoverLegacyLifecycle(
              recovery,
              usageAuthorizer,
              dependencies,
            );
      if (outcome === 'recovered') result.recoveredCount += 1;
      else if (outcome === 'rolled_back') result.rolledBackCount += 1;
      else result.unresolvedCount += 1;
    } catch (error) {
      result.unresolvedCount += 1;
      dependencies.onError(error);
    }
  }
  return result;
}
