import type { PromptResult } from '../protocol/content';
import { sendRuntimeEvent } from '../protocol/runtime';
import { getActivePromptGroupId } from './state';
import type { PromptGroup } from './types';

export function setPageZoom(zoomFactor: number): void {
  sendRuntimeEvent({ type: 'SET_ZOOM', zoomFactor });
}

function statusResult(
  result: PromptResult,
): Pick<
  PromptResult,
  'index' | 'promptIndex' | 'success' | 'downloadComplete' | 'error'
> {
  return {
    index: result.index,
    promptIndex: result.promptIndex,
    success: result.success,
    downloadComplete: result.downloadComplete,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

export function publishPromptGroupStatus(group: PromptGroup): void {
  sendRuntimeEvent({
    type: 'PROMPT_GROUP_STATUS',
    data: {
      id: group.id,
      status: group.status,
      processedCount: group.processedCount,
      totalCount: group.totalCount,
      createdAt: group.createdAt,
      isCancelling: group.isCancelling,
      isActive: getActivePromptGroupId() === group.id,
      ...(group.delayRemainingSeconds === undefined
        ? {}
        : { delayRemainingSeconds: group.delayRemainingSeconds }),
      results: group.results.map(statusResult),
      ...(group.currentPromptIndex === undefined
        ? {}
        : { currentPromptIndex: group.currentPromptIndex }),
      promptPreviews: group.payloads.map((payload) =>
        payload.prompt.substring(0, 60),
      ),
      promptIndices: group.payloads.map((payload) => payload.promptIndex),
      retryCountByIndex: { ...group.retryCountByIndex },
      downloadRetryCountByIndex: { ...group.downloadRetryCountByIndex },
    },
  });
}
