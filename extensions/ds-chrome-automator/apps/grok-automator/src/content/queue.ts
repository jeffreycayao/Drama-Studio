import type {
  AutomationConfig,
  PreparedImage,
  PromptPayload,
  PromptResult,
} from '../protocol/content';
import type { AutoFillGrokMessage } from '../protocol/content';
import { sendRuntimeEvent } from '../protocol/runtime';
import {
  resolveBlockedStagePayloads,
  stagePayloadsWithoutPreparedImages,
  type BlockedPromptStage,
  type BlockedPromptStageInput,
} from '../protocol/prompt-stage';
import { runPromptAutomation } from './automation';
import {
  promptStageClient,
  type PromptStageClient,
} from './prompt-stage-client';
import {
  calculateDelayMilliseconds,
  takeNextReadyPromptIndex,
} from './scheduling';
import {
  downloadQueue,
  pendingPromptGroups,
  preparedImages,
  promptGroupQueue,
} from './state';
import { publishPromptGroupStatus } from './status';
import type { DownloadItem, PromptGroup, SendResponse } from './types';

const preparedImageUsageByGroup = new Map<string, Map<string, PreparedImage>>();
const promptGroupReleaseOperations = new Map<
  string,
  Promise<Record<string, unknown>>
>();
const PENDING_PROMPT_GROUP_TIMEOUT_MS = 60_000;

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitPromptDelay(
  group: PromptGroup,
  promptArrayIndex: number,
): Promise<boolean> {
  if (promptArrayIndex === 0) return true;
  const milliseconds = calculateDelayMilliseconds(
    group.promptDelaySecondsMin,
    group.promptDelaySecondsMax,
  );
  let remaining = milliseconds;
  while (remaining > 0) {
    group.delayRemainingSeconds = Math.ceil(remaining / 1_000);
    publishPromptGroupStatus(group);
    const increment = Math.min(1_000, remaining);
    await sleep(increment);
    remaining -= increment;
    if (group.isCancelling) return false;
  }
  delete group.delayRemainingSeconds;
  return true;
}

function automationPromptResult(
  promptArrayIndex: number,
  payload: PromptPayload,
  result: Awaited<ReturnType<typeof runPromptAutomation>>,
  group: PromptGroup,
): PromptResult {
  return {
    index: promptArrayIndex,
    promptIndex: payload.promptIndex,
    success: result.success,
    downloadComplete: false,
    steps: result.steps,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(group.isCancelling ? { cancelled: true } : {}),
  };
}

export async function processNextPrompt(
  group: PromptGroup,
  config: AutomationConfig,
): Promise<void> {
  while (!group.isCancelling && group.processedCount < group.totalCount) {
    const inFlightDownloads = downloadQueue.filter(
      (candidate) => candidate.id === group.id,
    ).length;
    if (inFlightDownloads >= group.concurrentPrompts) {
      await sleep(500);
      continue;
    }

    const promptArrayIndex = takeNextReadyPromptIndex(group);
    if (promptArrayIndex === null) {
      if (group.processedCount >= group.totalCount) return;
      await sleep(500);
      continue;
    }
    const sourcePayload = group.payloads[promptArrayIndex];
    if (!sourcePayload) continue;
    const payload: PromptPayload = {
      ...sourcePayload,
      ...(sourcePayload.images ? { images: [...sourcePayload.images] } : {}),
    };
    if (!(await waitPromptDelay(group, promptArrayIndex))) return;

    try {
      group.currentPromptIndex = promptArrayIndex;
      publishPromptGroupStatus(group);
      const result = await runPromptAutomation(
        payload,
        () => group.isCancelling,
        config,
      );
      delete group.currentPromptIndex;

      const retryCount = group.retryCountByIndex[promptArrayIndex] ?? 0;
      if (
        !result.success &&
        !result.cancelled &&
        retryCount < (payload.maxRetries ?? 5)
      ) {
        group.retryCountByIndex[promptArrayIndex] = retryCount + 1;
        if (!group.pendingIndexes.includes(promptArrayIndex)) {
          group.pendingIndexes.unshift(promptArrayIndex);
        }
        publishPromptGroupStatus(group);
        continue;
      }

      group.completedPromptIndexes.add(promptArrayIndex);
      group.results.push(
        automationPromptResult(promptArrayIndex, payload, result, group),
      );
      if (result.success && result.elementIDs?.length) {
        const downloadItem: DownloadItem = {
          elementIDs: result.elementIDs,
          config: { ...sourcePayload },
          promptIndex: sourcePayload.promptIndex,
          index: promptArrayIndex,
          retryCount: group.downloadRetryCountByIndex[promptArrayIndex] ?? 0,
        };
        downloadQueue.push({
          id: group.id,
          items: [downloadItem],
          status: 'queued',
          isCancelling: group.isCancelling,
        });
      }
      group.processedCount += 1;
      publishPromptGroupStatus(group);
    } catch (error) {
      delete group.currentPromptIndex;
      group.completedPromptIndexes.add(promptArrayIndex);
      group.results.push({
        index: promptArrayIndex,
        promptIndex: payload.promptIndex,
        success: false,
        downloadComplete: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      group.processedCount += 1;
      publishPromptGroupStatus(group);
    }
  }
}

export function markDownloadComplete(
  item: DownloadItem,
  groupId: string,
): void {
  const group = promptGroupQueue.find((candidate) => candidate.id === groupId);
  const result = group?.results.find(
    (candidate) => candidate.index === item.index,
  );
  if (!group || !result) return;
  result.downloadComplete = true;
  publishPromptGroupStatus(group);
}

export function markDownloadFailed(
  item: DownloadItem,
  groupId: string,
  errorMessage: string,
): void {
  const group = promptGroupQueue.find((candidate) => candidate.id === groupId);
  if (!group) return;
  group.results = group.results.filter((result) => result.index !== item.index);
  group.results.push({
    index: item.index,
    promptIndex: item.config.promptIndex,
    success: false,
    downloadComplete: true,
    error: errorMessage || 'Download failed',
  });
  publishPromptGroupStatus(group);
}

export function retryDownloadOrFail(
  item: DownloadItem,
  groupId: string,
  failureReason?: string,
  failedResourceIndexes?: readonly number[],
  resourceDescriptors = item.resourceDescriptors,
): void {
  const maximumRetries = item.config.maxRetries ?? 5;
  const group = promptGroupQueue.find((candidate) => candidate.id === groupId);
  const retryIndexes = [
    ...new Set(
      (failedResourceIndexes ?? []).filter(
        (index) =>
          Number.isSafeInteger(index) &&
          index >= 0 &&
          index < (resourceDescriptors?.length ?? 0),
      ),
    ),
  ];
  const hasStableDirectRetry =
    resourceDescriptors !== undefined && retryIndexes.length > 0;
  if (
    hasStableDirectRetry &&
    item.retryCount < maximumRetries &&
    group?.status === 'running'
  ) {
    group.downloadRetryCountByIndex[item.index] =
      (group.downloadRetryCountByIndex[item.index] ?? 0) + 1;
    downloadQueue.push({
      id: groupId,
      items: [
        {
          ...item,
          retryCount: item.retryCount + 1,
          pendingResourceIndexes: retryIndexes,
          resourceDescriptors: resourceDescriptors.map((resource) => ({
            ...resource,
          })),
        },
      ],
      status: 'queued',
      isCancelling: group.isCancelling,
    });
    publishPromptGroupStatus(group);
    return;
  }
  if (group) {
    const finalReason = hasStableDirectRetry
      ? failureReason
        ? `${failureReason}; exceeded maxRetries (${maximumRetries})`
        : `Exceeded maxRetries (${maximumRetries})`
      : failureReason
        ? `${failureReason}; download cannot be retried without stable failed-resource descriptors`
        : 'Download cannot be retried without stable failed-resource descriptors';
    markDownloadFailed(item, groupId, finalReason);
    group.completedPromptIndexes.add(item.index);
  }
}

function resolvePayloadImages(
  payload: PromptPayload,
  usedPreparedImages: Map<string, PreparedImage>,
): PromptPayload {
  if (!payload.imageIds) return { ...payload };
  const images = payload.imageIds.flatMap((imageId) => {
    const image = preparedImages[imageId];
    if (image) usedPreparedImages.set(imageId, image);
    return image ? [image] : [];
  });
  return { ...payload, images };
}

export function reclaimPreparedImagesForGroup(groupId: string): void {
  const usedPreparedImages = preparedImageUsageByGroup.get(groupId);
  if (!usedPreparedImages) return;
  for (const [imageId, image] of usedPreparedImages) {
    if (preparedImages[imageId] === image) delete preparedImages[imageId];
  }
  preparedImageUsageByGroup.delete(groupId);
}

export function enqueuePromptGroup(
  message: AutoFillGrokMessage,
  sendResponse: SendResponse,
): PromptGroup {
  const id =
    message.groupId ||
    `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existing =
    pendingPromptGroups[id]?.group ??
    promptGroupQueue.find((candidate) => candidate.id === id);
  const acceptanceAlreadyPending = Object.values(pendingPromptGroups).some(
    (candidate) => candidate.acceptanceId === message.acceptanceId,
  );
  if (existing || acceptanceAlreadyPending) {
    sendResponse({ success: false, error: 'Prompt group already exists' });
    return existing ?? Object.values(pendingPromptGroups)[0]!.group;
  }
  const usedPreparedImages = new Map<string, PreparedImage>();
  const resolvedPayloads = message.payloads.map((payload) =>
    resolvePayloadImages(payload, usedPreparedImages),
  );
  if (usedPreparedImages.size > 0) {
    preparedImageUsageByGroup.set(id, usedPreparedImages);
  }
  const group: PromptGroup = {
    id,
    acceptanceId: message.acceptanceId,
    payloads: resolvedPayloads.map((payload) => ({ ...payload, groupId: id })),
    concurrentPrompts: message.concurrentPrompts || 2,
    promptDelaySecondsMin: message.promptDelaySecondsMin || 0,
    promptDelaySecondsMax: message.promptDelaySecondsMax || 0,
    status: 'queued',
    createdAt: Date.now(),
    processedCount: 0,
    totalCount: resolvedPayloads.length,
    isCancelling: false,
    results: [],
    pendingIndexes: resolvedPayloads.map((_, index) => index),
    completedPromptIndexes: new Set(),
    retryCountByIndex: {},
    downloadRetryCountByIndex: {},
  };
  pendingPromptGroups[id] = {
    acceptanceId: message.acceptanceId,
    group,
    preparedImages: Object.fromEntries(usedPreparedImages),
  };
  globalThis.setTimeout(() => {
    const pending = pendingPromptGroups[id];
    if (pending?.acceptanceId !== message.acceptanceId) return;
    delete pendingPromptGroups[id];
    reclaimPreparedImagesForGroup(id);
  }, PENDING_PROMPT_GROUP_TIMEOUT_MS);
  sendResponse({ success: true, acceptanceId: message.acceptanceId });
  return group;
}

function blockedStageInputFromPending(
  pending: (typeof pendingPromptGroups)[string],
): BlockedPromptStageInput {
  return {
    schemaVersion: 1,
    groupId: pending.group.id,
    acceptanceId: pending.acceptanceId,
    createdAt: pending.group.createdAt,
    payloads: stagePayloadsWithoutPreparedImages(pending.group.payloads),
    preparedImages: { ...pending.preparedImages },
    concurrentPrompts: pending.group.concurrentPrompts,
    promptDelaySecondsMin: pending.group.promptDelaySecondsMin,
    promptDelaySecondsMax: pending.group.promptDelaySecondsMax,
  };
}

function promptGroupFromBlockedStage(stage: BlockedPromptStage): PromptGroup {
  const payloads = resolveBlockedStagePayloads(stage).map((payload) => ({
    ...payload,
    groupId: stage.groupId,
  }));
  return {
    id: stage.groupId,
    acceptanceId: stage.acceptanceId,
    payloads,
    concurrentPrompts: stage.concurrentPrompts,
    promptDelaySecondsMin: stage.promptDelaySecondsMin,
    promptDelaySecondsMax: stage.promptDelaySecondsMax,
    status: 'queued',
    createdAt: stage.createdAt,
    processedCount: 0,
    totalCount: payloads.length,
    isCancelling: false,
    results: [],
    pendingIndexes: payloads.map((_, index) => index),
    completedPromptIndexes: new Set(),
    retryCountByIndex: {},
    downloadRetryCountByIndex: {},
  };
}

export async function commitPromptGroup(
  groupId: string,
  acceptanceId: string,
  client: PromptStageClient = promptStageClient,
): Promise<Record<string, unknown>> {
  const existingStatus = await client.status(groupId, acceptanceId);
  if (existingStatus !== 'missing') {
    return {
      success: true,
      status: existingStatus,
      acceptanceId,
      alreadyCommitted: true,
    };
  }
  const pending = pendingPromptGroups[groupId];
  if (!pending || pending.acceptanceId !== acceptanceId) {
    return { success: false, error: 'Pending prompt group was not accepted' };
  }
  const status = await client.store(blockedStageInputFromPending(pending));
  if (status !== 'blocked' && status !== 'released') {
    return { success: false, error: 'Prompt group was not durably staged' };
  }
  delete pendingPromptGroups[groupId];
  reclaimPreparedImagesForGroup(groupId);
  return { success: true, status, acceptanceId };
}

export async function queryPromptGroupCommitStatus(
  groupId: string,
  acceptanceId: string,
  client: PromptStageClient = promptStageClient,
): Promise<Record<string, unknown>> {
  const durableStatus = await client.status(groupId, acceptanceId);
  if (durableStatus !== 'missing') {
    return { success: true, status: durableStatus, acceptanceId };
  }
  const pending = pendingPromptGroups[groupId];
  if (pending) {
    return pending.acceptanceId === acceptanceId
      ? { success: true, status: 'pending', acceptanceId }
      : { success: false, error: 'Prompt group acceptance did not match' };
  }
  return { success: true, status: 'missing', acceptanceId };
}

async function releasePromptGroupOnce(
  groupId: string,
  acceptanceId: string,
  client: PromptStageClient,
): Promise<Record<string, unknown>> {
  const status = await client.markReleased(groupId, acceptanceId);
  if (status === 'missing') {
    return { success: false, error: 'Blocked prompt group was not found' };
  }
  const existing = promptGroupQueue.find((group) => group.id === groupId);
  if (existing) {
    if (existing.acceptanceId !== acceptanceId) {
      return { success: false, error: 'Prompt group acceptance did not match' };
    }
    return {
      success: true,
      status: 'released',
      acceptanceId,
      alreadyReleased: true,
    };
  }
  if (status === 'claimed') {
    return {
      success: true,
      status: 'claimed',
      acceptanceId,
      alreadyReleased: true,
    };
  }
  const stage = await client.read(groupId, acceptanceId);
  if (!stage) {
    return {
      success: false,
      error: 'Released prompt group payload was not found',
    };
  }
  if (stage.phase !== 'released') {
    return { success: false, error: 'Prompt group is still blocked' };
  }
  const group = promptGroupFromBlockedStage(stage);
  promptGroupQueue.push(group);
  publishPromptGroupStatus(group);
  await client.acknowledgeReleased(groupId, acceptanceId);
  return { success: true, status: 'released', acceptanceId };
}

export function releasePromptGroup(
  groupId: string,
  acceptanceId: string,
  client: PromptStageClient = promptStageClient,
): Promise<Record<string, unknown>> {
  const operationKey = `${groupId}:${acceptanceId}`;
  const existing = promptGroupReleaseOperations.get(operationKey);
  if (existing) return existing;
  const operation = releasePromptGroupOnce(groupId, acceptanceId, client);
  promptGroupReleaseOperations.set(operationKey, operation);
  const cleanup = (): void => {
    if (promptGroupReleaseOperations.get(operationKey) === operation)
      promptGroupReleaseOperations.delete(operationKey);
  };
  void operation.then(cleanup, cleanup);
  return operation;
}

export async function restoreDurablePromptStages(
  client: PromptStageClient = promptStageClient,
): Promise<number> {
  let restored = 0;
  for (const manifest of await client.list()) {
    if (manifest.phase === 'claimed') {
      sendRuntimeEvent({
        type: 'ACTION_LOG',
        data: {
          level: 'warn',
          message: `Run ${manifest.groupId} was interrupted after execution started and was not replayed automatically.`,
          timestamp: Date.now(),
        },
      });
      continue;
    }
    if (
      manifest.phase !== 'released' ||
      promptGroupQueue.some((group) => group.id === manifest.groupId)
    ) {
      continue;
    }
    const wasQueued = promptGroupQueue.some(
      (group) => group.id === manifest.groupId,
    );
    const result = await releasePromptGroup(
      manifest.groupId,
      manifest.acceptanceId,
      client,
    );
    if (
      result.success === true &&
      !wasQueued &&
      promptGroupQueue.some((group) => group.id === manifest.groupId)
    ) {
      restored += 1;
    }
  }
  return restored;
}

export async function discardBlockedPromptGroup(
  groupId: string,
  acceptanceId: string,
  client: PromptStageClient = promptStageClient,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await client.discard(groupId, acceptanceId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(100);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Durable prompt stage cleanup failed');
}
