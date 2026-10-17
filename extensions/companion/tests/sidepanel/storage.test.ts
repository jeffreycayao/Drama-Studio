import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DEFAULT_SETTINGS } from '../../src/sidepanel/settings';
import {
  loadSettings,
  saveSettings,
  watchSettings,
} from '../../src/sidepanel/storage';
import type { Settings } from '../../src/sidepanel/types';

describe('settings storage synchronization', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('publishes validated settings changes through the WXT item watcher', async () => {
    const changes: Settings[] = [];
    const errors: unknown[] = [];
    const stop = watchSettings(
      (settings) => changes.push(settings),
      (error) => errors.push(error),
    );

    try {
      await saveSettings({ ...DEFAULT_SETTINGS, imageOutputCount: 12 });
      await expect.poll(() => changes.length).toBe(1);
      expect(changes[0]?.imageOutputCount).toBe(12);
      expect(errors).toEqual([]);
    } finally {
      stop();
    }
  });

  it('reports invalid watched values without publishing replacement defaults', async () => {
    const changes: Settings[] = [];
    const errors: unknown[] = [];
    const stop = watchSettings(
      (settings) => changes.push(settings),
      (error) => errors.push(error),
    );

    try {
      await fakeBrowser.storage.local.set({
        'grok-batch-settings': { ...DEFAULT_SETTINGS, maxRetries: 0 },
      });
      await expect.poll(() => errors.length).toBe(1);
      expect(changes).toEqual([]);
    } finally {
      stop();
    }
  });

  it('leaves corrupt stored settings untouched when loading fails', async () => {
    const corrupt = { ...DEFAULT_SETTINGS, imageOutputCount: 13 };
    await fakeBrowser.storage.local.set({ 'grok-batch-settings': corrupt });

    await expect(loadSettings()).rejects.toThrow();
    await expect(
      fakeBrowser.storage.local.get('grok-batch-settings'),
    ).resolves.toEqual({ 'grok-batch-settings': corrupt });
  });
});
