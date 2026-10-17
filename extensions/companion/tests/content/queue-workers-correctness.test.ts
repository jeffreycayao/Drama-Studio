// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPromptAutomation } from '../../src/content/automation';
import { isRetryableFailure } from '../../src/content/guard';
import { cancelPromptGroup } from '../../src/content/messages';
import {
  enqueuePromptGroup,
  processNextPrompt,
  reclaimPreparedImagesForGroup,
  retryDownloadOrFail,
} from '../../src/content/queue';
import {
  downloadQueue,
  preparedImages,
  promptGroupQueue,
  resetContentState,
} from '../../src/content/state';
import type { DownloadItem, PromptGroup } from '../../src/content/types';
import {
  runPromptGroupWorkerIteration,
  terminalGroupStatus,
} from '../../src/content/workers';
import type { PromptPayload } from '../../src/protocol/content';
import { grokAdapter } from '../../src/sites/grok';

vi.mock('../../src/content/automation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/content/automation')>()),
  runPromptAutomation: vi.fn(),
}));

const automation = vi.mocked(runPromptAutomation);

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

function runningGroup(promptCount = 1): PromptGroup {
  const payloads = Array.from({ length: promptCount }, (_, index) => ({
    ...basePayload(),
    promptIndex: index + 1,
  }));
  return {
    id: 'group-correctness',
    payloads,
    concurrentPrompts: 1,
    promptDelaySecondsMin: 0,
    promptDelaySecondsMax: 0,
    status: 'running',
    createdAt: 1,
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

function groupWithResult(
  success: boolean,
  downloadComplete = true,
): PromptGroup {
  return {
    ...runningGroup(),
    processedCount: 1,
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

/** A Grok page whose prompt box exists, so the health check passes. */
function healthyGrokPage(extra = ''): void {
  document.body.innerHTML = `<form><div contenteditable="true"></div></form>${extra}`;
}

beforeEach(() => {
  automation.mockReset();
  healthyGrokPage();
});

afterEach(() => {
  resetContentState();
  vi.useRealTimers();
});

describe('prompt group terminal state', () => {
  it('uses completed only when every result succeeded and completed its download stage', () => {
    expect(terminalGroupStatus(groupWithResult(true))).toBe('completed');
    expect(terminalGroupStatus(groupWithResult(false))).toBe('error');
    expect(terminalGroupStatus(groupWithResult(true, false))).toBe('error');
  });
});

describe('stop on blocking page states', () => {
  it('sends nothing and stops the whole batch when a CAPTCHA is showing', async () => {
    healthyGrokPage(
      '<iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge"></iframe>',
    );
    const group = runningGroup(3);

    await processNextPrompt(group, grokAdapter);

    expect(automation).not.toHaveBeenCalled();
    expect(group.stop?.reason).toBe('captcha');
    expect(group.isCancelling).toBe(true);
    expect(group.pendingIndexes).toEqual([]);
  });

  it('does not retry a failed prompt when Grok shows a usage limit', async () => {
    const group = runningGroup(2);
    automation.mockImplementationOnce(async () => {
      healthyGrokPage(
        '<div role="alert">You have reached your daily limit. Try again tomorrow.</div>',
      );
      return { success: false, steps: [], error: 'Could not find element IDs' };
    });

    await processNextPrompt(group, grokAdapter);

    expect(automation).toHaveBeenCalledTimes(1);
    expect(group.stop?.reason).toBe('usage-limit');
    expect(group.retryCountByIndex).toEqual({});
    expect(group.pendingIndexes).toEqual([]);
    expect(group.results).toHaveLength(1);
    expect(group.results[0]?.success).toBe(false);
  });

  it('ignores limit wording that is only inside the prompt box', async () => {
    healthyGrokPage(
      '<div role="dialog"><textarea>explain rate limit errors</textarea></div>',
    );
    const group = runningGroup(1);
    automation.mockResolvedValueOnce({
      success: true,
      steps: [],
      elementIDs: ['[data-result="ok"]'],
    });

    await processNextPrompt(group, grokAdapter);

    expect(group.stop).toBeUndefined();
    expect(automation).toHaveBeenCalledTimes(1);
  });

  it('cancels the batch downloads when it stops, since an upscale is a new generation', async () => {
    const group = runningGroup(1);
    downloadQueue.push({
      id: group.id,
      items: [downloadItem()],
      status: 'queued',
      isCancelling: false,
    });
    healthyGrokPage('<div role="alert">Too many requests</div>');

    await processNextPrompt(group, grokAdapter);

    expect(group.stop?.reason).toBe('usage-limit');
    expect(downloadQueue[0]?.isCancelling).toBe(true);
  });
});

describe('retry policy', () => {
  it('retries a prompt only after a timeout or network error', async () => {
    const group = runningGroup(1);
    automation
      .mockResolvedValueOnce({
        success: false,
        steps: [],
        error: 'Could not find element IDs',
      })
      .mockResolvedValueOnce({
        success: true,
        steps: [],
        elementIDs: ['[data-result="ok"]'],
      });

    await processNextPrompt(group, grokAdapter);

    expect(automation).toHaveBeenCalledTimes(2);
    expect(group.retryCountByIndex[0]).toBe(1);
    expect(group.results.at(-1)?.success).toBe(true);
  });

  it('records other failures once instead of repeating them', async () => {
    const group = runningGroup(1);
    automation.mockResolvedValueOnce({
      success: false,
      steps: [],
      error: 'Failed to fill prompt',
    });

    await processNextPrompt(group, grokAdapter);

    expect(automation).toHaveBeenCalledTimes(1);
    expect(group.retryCountByIndex).toEqual({});
    expect(group.results[0]?.error).toBe('Failed to fill prompt');
  });

  it('classifies failures', () => {
    expect(isRetryableFailure('Could not find element IDs')).toBe(true);
    expect(isRetryableFailure('Request timed out')).toBe(true);
    expect(isRetryableFailure('Failed to fetch')).toBe(true);
    expect(isRetryableFailure('Failed to configure video')).toBe(false);
    expect(isRetryableFailure(undefined)).toBe(false);
  });
});

describe('batch start checks', () => {
  it('stops before the first prompt when the page asks the user to sign in', async () => {
    healthyGrokPage('<a href="/sign-in">Sign in</a>');
    const group = runningGroup(2);
    group.status = 'queued';
    promptGroupQueue.push(group);
    const processor = vi.fn();

    await runPromptGroupWorkerIteration(processor);

    expect(processor).not.toHaveBeenCalled();
    expect(group.status).toBe('stopped');
    expect(group.stop?.reason).toBe('sign-in');
    expect(promptGroupQueue).not.toContain(group);
  });

  it('reports a changed site instead of failing silently', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main>Grok redesigned this page</main>';
    const group = runningGroup(1);
    group.status = 'queued';
    promptGroupQueue.push(group);
    const processor = vi.fn();

    const iteration = runPromptGroupWorkerIteration(processor);
    await vi.advanceTimersByTimeAsync(11_000);
    await iteration;

    expect(processor).not.toHaveBeenCalled();
    expect(group.status).toBe('stopped');
    expect(group.stop?.reason).toBe('site-changed');
  });

  it('runs a batch on a healthy page', async () => {
    const group = runningGroup(1);
    group.status = 'queued';
    promptGroupQueue.push(group);
    const processor = vi.fn(async () => undefined);

    await runPromptGroupWorkerIteration(processor);

    expect(processor).toHaveBeenCalledWith(group);
    expect(group.status).toBe('running');
  });
});

describe('stable download retry state', () => {
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

  it('marks the result failed when no stable descriptors exist to retry', () => {
    const group = groupWithResult(true, false);
    promptGroupQueue.push(group);

    retryDownloadOrFail(downloadItem(), group.id, 'download failed');

    expect(group.results[0]).toMatchObject({
      success: false,
      downloadComplete: true,
    });
    expect(terminalGroupStatus(group)).toBe('error');
  });
});

describe('prepared image lifecycle', () => {
  it('queues a group at once and resolves its prepared images', () => {
    const prepared = {
      base64: 'data:image/png;base64,AA==',
      name: 'source.png',
    };
    preparedImages['prepared-one'] = prepared;
    const responses: unknown[] = [];
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        groupId: 'group-images',
        payloads: [{ ...basePayload(), imageIds: ['prepared-one'] }],
      },
      (response) => responses.push(response),
    );

    expect(group).not.toBeNull();
    expect(promptGroupQueue).toContain(group);
    expect(responses).toEqual([{ success: true, groupId: 'group-images' }]);

    reclaimPreparedImagesForGroup('group-images');
    expect(preparedImages['prepared-one']).toBeUndefined();
    expect(group?.payloads[0]?.images).toEqual([prepared]);
  });

  it('refuses a duplicate group id', () => {
    const message = {
      type: 'AUTO_FILL_GROK' as const,
      groupId: 'group-twice',
      payloads: [basePayload()],
    };
    enqueuePromptGroup(message, () => undefined);
    const responses: unknown[] = [];

    expect(enqueuePromptGroup(message, (r) => responses.push(r))).toBeNull();
    expect(responses[0]).toMatchObject({ success: false });
    expect(promptGroupQueue).toHaveLength(1);
  });

  it('reclaims prepared image IDs when a queued group is cancelled', () => {
    preparedImages['prepared-cancelled'] = {
      base64: 'data:image/png;base64,AA==',
      name: 'cancelled.png',
    };
    const group = enqueuePromptGroup(
      {
        type: 'AUTO_FILL_GROK',
        groupId: 'group-cancelled-images',
        payloads: [{ ...basePayload(), imageIds: ['prepared-cancelled'] }],
      },
      () => undefined,
    );

    expect(cancelPromptGroup('group-cancelled-images')).toMatchObject({
      success: true,
      cancelled: true,
    });
    expect(preparedImages['prepared-cancelled']).toBeUndefined();
    expect(promptGroupQueue).not.toContain(group);
  });
});
