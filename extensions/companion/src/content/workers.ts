import { grokAdapter } from '../sites/grok';
import { SITE_CHANGED_MESSAGE } from '../sites/page-state';
import { downloadFromElementIds } from './downloads';
import { checkGrokHealth, detectGrokPageStop, stopGroup } from './guard';
import {
  markDownloadComplete,
  markDownloadFailed,
  processNextPrompt,
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
import type { PromptGroup } from './types';

const PAGE_MONITOR_INTERVAL_MS = 1_500;
const HEALTH_WAIT_MS = 10_000;

function finishGroup(group: PromptGroup): void {
  reclaimPreparedImagesForGroup(group.id);
  const index = promptGroupQueue.indexOf(group);
  if (index >= 0) promptGroupQueue.splice(index, 1);
  setActivePromptGroupId(null);
  setPageZoom(1);
}

/** Waits briefly for Grok's prompt box; a slow page is not a changed site. */
async function waitForHealthyPage(): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_WAIT_MS) {
    if (checkGrokHealth().ok) return true;
    await sleep(500);
  }
  return checkGrokHealth().ok;
}

export function terminalGroupStatus(group: PromptGroup): 'completed' | 'error' {
  const allSucceeded =
    group.results.length === group.totalCount &&
    group.results.every((result) => result.success && result.downloadComplete);
  return allSucceeded ? 'completed' : 'error';
}

export async function processPromptGroup(group: PromptGroup): Promise<void> {
  const config = grokAdapter;

  while (true) {
    if (group.isCancelling) {
      group.status = group.stop ? 'stopped' : 'cancelled';
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
): Promise<boolean> {
  const group = promptGroupQueue[0];
  if (!group) return false;
  if (group.status === 'cancelled') {
    finishGroup(group);
    return true;
  }
  setActivePromptGroupId(group.id);

  const stopBeforeStart =
    detectGrokPageStop() ??
    ((await waitForHealthyPage())
      ? null
      : { reason: 'site-changed' as const, message: SITE_CHANGED_MESSAGE });
  if (stopBeforeStart) {
    stopGroup(group, stopBeforeStart);
    group.status = 'stopped';
    publishPromptGroupStatus(group);
    finishGroup(group);
    return true;
  }

  group.status = 'running';
  publishPromptGroupStatus(group);
  setPageZoom(0.5);
  const monitor = globalThis.setInterval(() => {
    const stop = detectGrokPageStop();
    if (stop) stopGroup(group, stop);
  }, PAGE_MONITOR_INTERVAL_MS);
  try {
    await processor(group);
  } catch {
    group.status = 'error';
    publishPromptGroupStatus(group);
    finishGroup(group);
  } finally {
    globalThis.clearInterval(monitor);
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
    const config = grokAdapter;

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
