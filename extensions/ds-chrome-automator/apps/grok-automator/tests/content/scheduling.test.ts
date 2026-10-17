import { findInlineImageMatches } from '../../src/content/automation';
import {
  calculateDelayMilliseconds,
  isPromptReady,
  takeNextReadyPromptIndex,
} from '../../src/content/scheduling';
import type { PromptGroup } from '../../src/content/types';
import { describe, expect, it } from 'vitest';

function groupForScheduling(): PromptGroup {
  const payloadBase = {
    promptIndex: 1,
    mode: 'textToVideo' as const,
    aspectRatio: '16:9',
    outputCount: 1,
    folderName: '',
    videoOption: '6s',
    autoDownloadResourceQuality: 'no-download',
  };
  return {
    id: 'group-test',
    acceptanceId: 'run.scheduling_1234567890',
    payloads: [
      { ...payloadBase, prompt: 'first', isConcat: true },
      { ...payloadBase, prompt: 'second', promptIndex: 2 },
    ],
    concurrentPrompts: 1,
    promptDelaySecondsMin: 0,
    promptDelaySecondsMax: 0,
    status: 'running',
    createdAt: 1,
    processedCount: 0,
    totalCount: 2,
    isCancelling: false,
    results: [],
    pendingIndexes: [1, 0],
    completedPromptIndexes: new Set(),
    retryCountByIndex: {},
    downloadRetryCountByIndex: {},
  };
}

describe('prompt scheduling', () => {
  it('blocks a prompt until the previous concat prompt completes', () => {
    const group = groupForScheduling();
    expect(isPromptReady(group, 1)).toBe(false);
    expect(takeNextReadyPromptIndex(group)).toBe(0);
    group.completedPromptIndexes.add(0);
    expect(takeNextReadyPromptIndex(group)).toBe(1);
  });

  it('calculates bounded deterministic delays', () => {
    expect(calculateDelayMilliseconds(2, 6, 0.25)).toBe(3_000);
    expect(calculateDelayMilliseconds(-2, -1, 0.5)).toBe(0);
    expect(calculateDelayMilliseconds(4, 2, 0.5)).toBe(4_000);
  });
});

describe('inline image matching', () => {
  it('finds named image references and preserves first-image precedence on overlaps', () => {
    const matches = findInlineImageMatches(
      'Place hero beside hero-wide and HERO again',
      [
        { base64: 'a', name: 'hero.jpg' },
        { base64: 'b', name: 'hero-wide.png' },
      ],
    );
    expect(matches.map((match) => match.imageIndex)).toEqual([0, 0, 0]);
  });
});
