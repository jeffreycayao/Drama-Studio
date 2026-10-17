import {
  commitPromptGroup,
  enqueuePromptGroup,
  queryPromptGroupCommitStatus,
  reclaimPreparedImagesForGroup,
  releasePromptGroup,
  restoreDurablePromptStages,
  retryDownloadOrFail,
} from '../../src/content/queue';
import { cancelPromptGroup } from '../../src/content/messages';
import {
  downloadQueue,
  pendingPromptGroups,
  preparedImages,
  promptGroupQueue,
  resetContentState,
} from '../../src/content/state';
import type {
  DownloadGroup,
  DownloadItem,
  PromptGroup,
} from '../../src/content/types';
import {
  handleDownloadConfigFailure,
  runPromptGroupWorkerIteration,
  terminalGroupStatus,
} from '../../src/content/workers';
import type { PromptPayload } from '../../src/protocol/content';
import {
  estimateBlockedPromptStageChars,
  type BlockedPromptStage,
  type BlockedPromptStageInput,
} from '../../src/protocol/prompt-stage';
import type { PromptStageClient } from '../../src/content/prompt-stage-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

function basePayload(): PromptPayload {
  return {
    prompt: 'A cinematic sunrise',
    promptIndex: 1,
    mode: 'textToImage',
    aspectRatio: '16:9',
    outputCount: 1,
    folderName: 'results',
    imageModel: 'quality',
    autoDownloadResourceQuality: '1k',
    maxRetries: 2,
  };
}

function groupWithResult(
  success: boolean,
  downloadComplete = true,
): PromptGroup {
  return {
    id: 'group-correctness',
    acceptanceId: 'run.correctness_1234567890',
    payloads: [basePayload()],
    concurrentPrompts: 1,
    promptDelaySecondsMin: 0,
    promptDelaySecondsMax: 0,
    status: 'running',
    createdAt: 1,
    processedCount: 1,
    totalCount: 1,
    isCancelling: false,
    results: [
      {
        index: 0,
        promptIndex: 1,
        success,
        downloadComplete,
        ...(success ? {} : { error: 'Generation failed' }),
      },
    ],
    pendingIndexes: [],
    completedPromptIndexes: new Set([0]),
    retryCountByIndex: {},
    downloadRetryCountByIndex: {},
  };
}

function createStageClient(): PromptStageClient {
  const stages = new Map<string, BlockedPromptStage>();
  const key = (groupId: string, acceptanceId: string) =>
    `${groupId}:${acceptanceId}`;
  return {
    status: async (groupId, acceptanceId) =>
      stages.get(key(groupId, acceptanceId))?.phase ?? 'missing',
    store: async (input: BlockedPromptStageInput) => {
      const stageKey = key(input.groupId, input.acceptanceId);
      if (!stages.has(stageKey)) {
        stages.set(stageKey, {
          ...input,
          tabId: 1,
          phase: 'blocked',
          expiresAt: Date.now() + 60_000,
          serializedChars: estimateBlockedPromptStageChars(input),
        });
      }
      return stages.get(stageKey)!.phase;
    },
    list: async () =>
      [...stages.values()].map((stage) => ({
        groupId: stage.groupId,
        acceptanceId: stage.acceptanceId,
        phase: stage.phase,
        serializedChars: JSON.stringify(stage).length,
        totalChunks: 1,
      })),
    read: async (groupId, acceptanceId) =>
      stages.get(key(groupId, acceptanceId)) ?? null,
    markReleased: async (groupId, acceptanceId) => {
      const stage = stages.get(key(groupId, acceptanceId));
      if (!stage) return 'missing';
      stage.phase = 'released';
      return 'released';
    },
    claim: async (groupId, acceptanceId) => {
      const stage = stages.get(key(groupId, acceptanceId));
      if (!stage) return { status: 'missing', newlyClaimed: false };
      if (stage.phase !== 'released') {
        return { status: stage.phase, newlyClaimed: false };
      }
      stage.phase = 'claimed';
      return { status: 'claimed', newlyClaimed: true };
    },
    acknowledgeReleased: async () => undefined,
    discard: async (groupId, acceptanceId) => {
      stages.delete(key(groupId, acceptanceId));
    },
  };
}

function downloadItem(retryCount = 0): DownloadItem {
  return {
    elementIDs: ['[data-result="one"]'],
    config: basePayload(),
    promptIndex: 1,
    index: 0,
    retryCount,
  };
}

function downloadGroup(item: DownloadItem): DownloadGroup {
  return {
    id: 'group-correctness',
    items: [item],
    status: 'running',
    isCancelling: false,
  };
}

afterEach(() => resetContentState());

describe('prompt group terminal state', () => {
  it('uses completed only when every result succeeded and completed its download stage', () => {
    expect(terminalGroupStatus(groupWithResult(true))).toBe('completed');
    expect(terminalGroupStatus(groupWithResult(false))).toBe('error');
    expect(terminalGroupStatus(groupWithResult(true, false))).toBe('error');
  });
});

describe('stable download retry state', () => {
  it('fails closed when configuration is unavailable before stable resources are discovered', () => {
    const group = groupWithResult(true, false);
    const queuedDownload = downloadGroup(downloadItem());
    promptGroupQueue.push(group);
    downloadQueue.push(queuedDownload);

    handleDownloadConfigFailure(queuedDownload);

    expect(queuedDownload.status).toBe('error');
    expect(group.pendingIndexes).toEqual([]);
    expect(group.processedCount).toBe(1);
    expect(group.results).toHaveLength(1);
    expect(group.completedPromptIndexes).toEqual(new Set([0]));
    expect(group.downloadRetryCountByIndex[0]).toBeUndefined();
    expect(downloadQueue).toHaveLength(1);
    expect(group.results[0]).toMatchObject({
      success: false,
      downloadComplete: true,
    });
  });

  it('requeues only explicit failed indexes with immutable first-discovery descriptors', () => {
    const group = groupWithResult(true, false);
    const item: DownloadItem = {
      ...downloadItem(),
      resourceDescriptors: [
        { kind: 'image', source: 'https://imgen.x.ai/first.png' },
        { kind: 'image', source: 'https://imgen.x.ai/second.png' },
      ],
    };
    promptGroupQueue.push(group);

    retryDownloadOrFail(
      item,
      group.id,
      'resource two failed',
      [1],
      item.resourceDescriptors,
    );

    expect(group.downloadRetryCountByIndex[0]).toBe(1);
    expect(downloadQueue).toHaveLength(1);
    expect(downloadQueue[0]).toMatchObject({
      id: group.id,
      status: 'queued',
      items: [
        {
          index: 0,
          retryCount: 1,
          pendingResourceIndexes: [1],
          resourceDescriptors: [
            { source: 'https://imgen.x.ai/first.png' },
            { source: 'https://imgen.x.ai/second.png' },
          ],
        },
      ],
    });
    expect(downloadQueue[0]?.items[0]?.resourceDescriptors).not.toBe(
      item.resourceDescriptors,
    );
  });

  it('marks the result failed when selector configuration retries are exhausted', () => {
    const group = groupWithResult(true, false);
    const queuedDownload = downloadGroup(downloadItem(2));
    promptGroupQueue.push(group);

    handleDownloadConfigFailure(queuedDownload);

    expect(group.results).toHaveLength(1);
    expect(group.results[0]).toMatchObject({
      success: false,
      downloadComplete: true,
    });
    expect(group.results[0]?.error).toContain(
      'Cannot load the validated automation selector configuration',
    );
    expect(terminalGroupStatus(group)).toBe('error');
  });
});

describe('prepared image lifecycle', () => {
  it('keeps a durably committed group non-runnable until exact release', async () => {
    const client = createStageClient();
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        groupId: 'group-two-phase',
        acceptanceId: 'run.two_phase_1234567890',
        payloads: [basePayload()],
      },
      () => undefined,
    );

    expect(promptGroupQueue).not.toContain(group);
    expect(pendingPromptGroups[group.id]?.group).toBe(group);
    await expect(
      commitPromptGroup(group.id, 'run.wrong_1234567890', client),
    ).resolves.toMatchObject({ success: false });
    expect(promptGroupQueue).not.toContain(group);
    await expect(
      commitPromptGroup(group.id, 'run.two_phase_1234567890', client),
    ).resolves.toEqual({
      success: true,
      status: 'blocked',
      acceptanceId: 'run.two_phase_1234567890',
    });
    expect(promptGroupQueue).toHaveLength(0);
    const automation = vi.fn(async () => undefined);
    await expect(runPromptGroupWorkerIteration(automation)).resolves.toBe(
      false,
    );
    expect(automation).not.toHaveBeenCalled();

    await expect(
      releasePromptGroup(group.id, 'run.two_phase_1234567890', client),
    ).resolves.toMatchObject({ success: true, status: 'released' });
    expect(promptGroupQueue).toHaveLength(1);
  });

  it('serializes concurrent release and queues the exact group only once', async () => {
    const client = createStageClient();
    const acceptanceId = 'run.idempotent_1234567890';
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        groupId: 'group-idempotent',
        acceptanceId,
        payloads: [basePayload()],
      },
      () => undefined,
    );

    await expect(
      queryPromptGroupCommitStatus(group.id, acceptanceId, client),
    ).resolves.toEqual({
      success: true,
      status: 'pending',
      acceptanceId,
    });
    await expect(
      commitPromptGroup(group.id, acceptanceId, client),
    ).resolves.toMatchObject({
      success: true,
      status: 'blocked',
    });
    await expect(
      commitPromptGroup(group.id, acceptanceId, client),
    ).resolves.toEqual({
      success: true,
      status: 'blocked',
      acceptanceId,
      alreadyCommitted: true,
    });
    await Promise.all([
      releasePromptGroup(group.id, acceptanceId, client),
      releasePromptGroup(group.id, acceptanceId, client),
      restoreDurablePromptStages(client),
    ]);
    expect(
      promptGroupQueue.filter((candidate) => candidate.id === group.id),
    ).toHaveLength(1);
  });

  it('rehydrates a released payload after true content-state reset without losing its prompt', async () => {
    const client = createStageClient();
    const acceptanceId = 'run.reload_recovery_1234567890';
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        groupId: 'group-reload-recovery',
        acceptanceId,
        payloads: [basePayload()],
      },
      () => undefined,
    );
    await commitPromptGroup(group.id, acceptanceId, client);
    await releasePromptGroup(group.id, acceptanceId, client);
    expect(promptGroupQueue[0]?.payloads[0]?.prompt).toBe(
      'A cinematic sunrise',
    );

    resetContentState();
    await expect(restoreDurablePromptStages(client)).resolves.toBe(1);
    expect(promptGroupQueue).toHaveLength(1);
    expect(promptGroupQueue[0]?.acceptanceId).toBe(acceptanceId);
    expect(promptGroupQueue[0]?.payloads[0]?.prompt).toBe(
      'A cinematic sunrise',
    );
  });

  it('durably claims before automation and never replays a started batch after reset', async () => {
    const client = createStageClient();
    const acceptanceId = 'run.claimed_no_replay_1234567890';
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        groupId: 'group-claimed-no-replay',
        acceptanceId,
        payloads: [basePayload(), { ...basePayload(), promptIndex: 2 }],
      },
      () => undefined,
    );
    await commitPromptGroup(group.id, acceptanceId, client);
    await releasePromptGroup(group.id, acceptanceId, client);
    const automation = vi.fn(async (claimedGroup: PromptGroup) => {
      claimedGroup.processedCount = 1;
    });

    await expect(
      runPromptGroupWorkerIteration(automation, client),
    ).resolves.toBe(true);
    expect(automation).toHaveBeenCalledOnce();
    resetContentState();

    await expect(restoreDurablePromptStages(client)).resolves.toBe(0);
    await expect(
      runPromptGroupWorkerIteration(automation, client),
    ).resolves.toBe(false);
    expect(automation).toHaveBeenCalledOnce();
    expect(promptGroupQueue).toHaveLength(0);
  });

  it('reclaims group-owned prepared image IDs without removing resolved payload data', () => {
    const prepared = {
      base64: 'data:image/png;base64,AA==',
      name: 'source.png',
    };
    preparedImages['prepared-one'] = prepared;
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        acceptanceId: 'run.1234567890abcdef',
        groupId: 'group-images',
        payloads: [{ ...basePayload(), imageIds: ['prepared-one'] }],
      },
      () => undefined,
    );

    reclaimPreparedImagesForGroup(group.id);

    expect(preparedImages['prepared-one']).toBeUndefined();
    expect(group.payloads[0]?.images).toEqual([prepared]);
  });

  it('reclaims prepared image IDs when a queued group is cancelled', async () => {
    preparedImages['prepared-cancelled'] = {
      base64: 'data:image/png;base64,AA==',
      name: 'cancelled.png',
    };
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        acceptanceId: 'run.abcdefghijklmnop',
        groupId: 'group-cancelled-images',
        payloads: [{ ...basePayload(), imageIds: ['prepared-cancelled'] }],
      },
      () => undefined,
    );

    await expect(cancelPromptGroup(group.id)).resolves.toMatchObject({
      success: true,
      cancelled: true,
    });
    expect(preparedImages['prepared-cancelled']).toBeUndefined();
    expect(promptGroupQueue).not.toContain(group);
  });
});
