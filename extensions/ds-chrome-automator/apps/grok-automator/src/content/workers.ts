import { requestRemoteConfig } from '../protocol/runtime';
import { sendRuntimeEvent } from '../protocol/runtime';
import { downloadFromElementIds } from './downloads';
import {
  promptStageClient,
  type PromptStageClient,
} from './prompt-stage-client';
import {
  markDownloadComplete,
  markDownloadFailed,
  processNextPrompt,
  discardBlockedPromptGroup,
  reclaimPreparedImagesForGroup,
  retryDownloadOrFail,
  sleep,
} from './queue';
import {
  downloadQueue,
  promptGroupQueue,
  setActivePromptGroupId,
} from './state';
import { publishPromptGroupStatus, setPageZoom } from './status';
import type { DownloadGroup, PromptGroup } from './types';

function finishGroup(group: PromptGroup): void {
  void discardBlockedPromptGroup(group.id, group.acceptanceId).catch(
    () => undefined,
  );
  reclaimPreparedImagesForGroup(group.id);
  const index = promptGroupQueue.indexOf(group);
  if (index >= 0) promptGroupQueue.splice(index, 1);
  setActivePromptGroupId(null);
  setPageZoom(1);
}

function abandonUnclaimableGroup(group: PromptGroup, message: string): void {
  group.status = 'error';
  publishPromptGroupStatus(group);
  const index = promptGroupQueue.indexOf(group);
  if (index >= 0) promptGroupQueue.splice(index, 1);
  setActivePromptGroupId(null);
  setPageZoom(1);
  sendRuntimeEvent({
    type: 'ACTION_LOG',
    data: { level: 'error', message, timestamp: Date.now() },
  });
}

export function terminalGroupStatus(group: PromptGroup): 'completed' | 'error' {
  const allSucceeded =
    group.results.length === group.totalCount &&
    group.results.every((result) => result.success && result.downloadComplete);
  return allSucceeded ? 'completed' : 'error';
}

export function handleDownloadConfigFailure(
  downloadGroup: DownloadGroup,
): void {
  const reason = 'Cannot load the validated automation selector configuration';
  for (const item of downloadGroup.items) {
    retryDownloadOrFail(item, downloadGroup.id, reason);
  }
  downloadGroup.status = 'error';
}

export async function processPromptGroup(group: PromptGroup): Promise<void> {
  const config = await requestRemoteConfig();
  if (!config) {
    group.status = 'error';
    publishPromptGroupStatus(group);
    finishGroup(group);
    return;
  }

  while (true) {
    if (group.isCancelling) {
      group.status = 'cancelled';
      publishPromptGroupStatus(group);
      finishGroup(group);
      return;
    }
    if (group.pendingIndexes.length > 0) {
      await processNextPrompt(group, config).catch(() => undefined);
    }
    while (downloadQueue.some((candidate) => candidate.id === group.id)) {
      await sleep(200);
    }
    if (group.pendingIndexes.length === 0) {
      group.status = terminalGroupStatus(group);
      publishPromptGroupStatus(group);
      finishGroup(group);
      return;
    }
  }
}

export async function runPromptGroupWorkerIteration(
  processor: (group: PromptGroup) => Promise<void> = processPromptGroup,
  stageClient: PromptStageClient = promptStageClient,
): Promise<boolean> {
  const group = promptGroupQueue[0];
  if (!group) return false;
  if (group.status === 'cancelled') {
    finishGroup(group);
    return true;
  }
  try {
    const claim = await stageClient.claim(group.id, group.acceptanceId);
    if (claim.status !== 'claimed' || !claim.newlyClaimed) {
      abandonUnclaimableGroup(
        group,
        `Run ${group.id} was already claimed or lost and was not replayed.`,
      );
      return true;
    }
  } catch (error) {
    abandonUnclaimableGroup(
      group,
      error instanceof Error
        ? error.message
        : `Run ${group.id} could not be durably claimed.`,
    );
    return true;
  }
  setActivePromptGroupId(group.id);
  group.status = 'running';
  publishPromptGroupStatus(group);
  setPageZoom(0.5);
  try {
    await processor(group);
  } catch {
    group.status = 'error';
    publishPromptGroupStatus(group);
    finishGroup(group);
  }
  return true;
}

export async function promptGroupWorkerLoop(): Promise<never> {
  while (true) {
    if (!(await runPromptGroupWorkerIteration())) {
      await sleep(1_000);
    }
  }
}

export async function downloadWorkerLoop(): Promise<never> {
  while (true) {
    const downloadGroup = downloadQueue[0];
    if (!downloadGroup) {
      await sleep(1_000);
      continue;
    }
    downloadGroup.status = 'running';
    const config = await requestRemoteConfig();
    if (!config) {
      handleDownloadConfigFailure(downloadGroup);
      downloadQueue.shift();
      continue;
    }

    for (const item of downloadGroup.items) {
      if (downloadGroup.isCancelling) break;
      const result = await downloadFromElementIds(
        item.elementIDs,
        item.config,
        () => downloadGroup.isCancelling,
        config,
        item.pendingResourceIndexes,
        item.resourceDescriptors,
      );
      const promptGroup = promptGroupQueue.find(
        (candidate) => candidate.id === downloadGroup.id,
      );
      const nextPayload = promptGroup?.payloads[item.index + 1];
      if (
        nextPayload &&
        (result.nextPromptExtendVideo !== undefined ||
          result.nextPromptEditImage !== undefined ||
          result.extractedFrame !== undefined)
      ) {
        nextPayload.outputPreviousPrompt = {
          ...(result.nextPromptExtendVideo === undefined
            ? {}
            : { nextPromptExtendVideo: result.nextPromptExtendVideo }),
          ...(result.nextPromptEditImage === undefined
            ? {}
            : { nextPromptEditImage: result.nextPromptEditImage }),
          ...(result.extractedFrame === undefined
            ? {}
            : { extractedFrame: result.extractedFrame }),
        };
      }
      if (result.success) {
        markDownloadComplete(item, downloadGroup.id);
      } else if (result.cancelled) {
        markDownloadFailed(
          item,
          downloadGroup.id,
          result.error ?? 'Download failed',
        );
      } else {
        retryDownloadOrFail(
          item,
          downloadGroup.id,
          result.error,
          result.failedResourceIndexes,
          result.resourceDescriptors,
        );
      }
    }
    downloadGroup.status = 'completed';
    downloadQueue.shift();
  }
}
