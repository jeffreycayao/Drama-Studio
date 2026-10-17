import type {
  AutomationConfig,
  PreparedImage,
  PromptPayload,
  PromptResult,
} from '../protocol/content';
import type { AutoFillGrokMessage } from '../protocol/content';
import { runPromptAutomation } from './automation';
import { detectGrokPageStop, isRetryableFailure, stopGroup } from './guard';
import {
  calculateDelayMilliseconds,
  takeNextReadyPromptIndex,
} from './scheduling';
import { downloadQueue, preparedImages, promptGroupQueue } from './state';
import { publishPromptGroupStatus } from './status';
import type { DownloadItem, PromptGroup, SendResponse } from './types';

const preparedImageUsageByGroup = new Map<string, Map<string, PreparedImage>>();

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
    const stopBeforePrompt = detectGrokPageStop();
    if (stopBeforePrompt) {
      stopGroup(group, stopBeforePrompt);
      return;
    }

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

      if (!result.success && !result.cancelled) {
        // A failed prompt is often the page telling us to stop. Check before
        // anything is retried, and never retry past a stop.
        const stopAfterFailure = detectGrokPageStop();
        if (stopAfterFailure) stopGroup(group, stopAfterFailure);
      }
      if (group.stop) {
        group.completedPromptIndexes.add(promptArrayIndex);
        group.results.push(
          automationPromptResult(promptArrayIndex, payload, result, group),
        );
        group.processedCount += 1;
        publishPromptGroupStatus(group);
        return;
      }

      const retryCount = group.retryCountByIndex[promptArrayIndex] ?? 0;
      if (
        !result.success &&
        !result.cancelled &&
        isRetryableFailure(result.error) &&
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
): PromptGroup | null {
  const id =
    message.groupId ||
    `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (promptGroupQueue.some((candidate) => candidate.id === id)) {
    sendResponse({ success: false, error: 'Prompt group already exists' });
    return null;
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
  promptGroupQueue.push(group);
  publishPromptGroupStatus(group);
  sendResponse({ success: true, groupId: id });
  return group;
}
