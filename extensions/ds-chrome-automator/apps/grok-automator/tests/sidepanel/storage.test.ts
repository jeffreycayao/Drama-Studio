import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DEFAULT_SETTINGS } from '../../src/sidepanel/settings';
import {
  clearInFlightRunCommit,
  IN_FLIGHT_RUN_COMMIT_MAX_AGE_MS,
  loadInFlightRunCommits,
  loadSettings,
  purgeLegacyAuthStorage,
  saveInFlightRunCommit,
  saveSettings,
  watchSettings,
  type InFlightRunCommit,
} from '../../src/sidepanel/storage';
import type { Settings } from '../../src/sidepanel/types';

describe('legacy authentication storage purge', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('removes the former email and access tokens from local and session storage', async () => {
    await Promise.all([
      fakeBrowser.storage.local.set({
        'auth-access-token': 'legacy-local-token',
        'auth-email': 'former@example.test',
        'unrelated-setting': true,
      }),
      fakeBrowser.storage.session.set({
        'auth-access-token': 'legacy-session-token',
      }),
    ]);

    await purgeLegacyAuthStorage();

    await expect(fakeBrowser.storage.local.get()).resolves.toEqual({
      'unrelated-setting': true,
    });
    await expect(fakeBrowser.storage.session.get()).resolves.toEqual({});
  });
});

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
        grok_automation_settings: { ...DEFAULT_SETTINGS, maxRetries: 0 },
      });
      await expect.poll(() => errors.length).toBe(1);
      expect(changes).toEqual([]);
    } finally {
      stop();
    }
  });

  it('leaves corrupt stored settings untouched when loading fails', async () => {
    const corrupt = { ...DEFAULT_SETTINGS, imageOutputCount: 13 };
    await fakeBrowser.storage.local.set({ grok_automation_settings: corrupt });

    await expect(loadSettings()).rejects.toThrow();
    await expect(
      fakeBrowser.storage.local.get('grok_automation_settings'),
    ).resolves.toEqual({ grok_automation_settings: corrupt });
  });
});

describe('in-flight Run commit metadata', () => {
  const now = Date.parse('2026-08-20T00:00:00.000Z');
  const entry: InFlightRunCommit = {
    lifecycle: 'reservation',
    authorizationId: 'authorization_1234567890',
    acceptanceId: 'run.storage_1234567890',
    groupId: 'group-storage-123',
    tabId: 42,
    createdAt: now,
  };

  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('validates metadata, enforces a bounded recovery window, and stores no payload', async () => {
    await saveInFlightRunCommit(entry, now);

    await expect(loadInFlightRunCommits(now)).resolves.toEqual([entry]);
    const activeStored = await fakeBrowser.storage.session.get();
    expect(
      Object.keys(activeStored).filter((key) =>
        key.startsWith('grok-run-commit-recovery:'),
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(activeStored)).not.toMatch(
      /prompt|payload|token|image/iu,
    );
    await expect(
      loadInFlightRunCommits(now + IN_FLIGHT_RUN_COMMIT_MAX_AGE_MS + 1),
    ).resolves.toEqual([]);
    const stored = await fakeBrowser.storage.session.get();
    expect(Object.keys(stored)).toHaveLength(0);
  });

  it('does not let stale cleanup remove a newer exact-session tuple', async () => {
    const newer = { ...entry, createdAt: now + 1 };
    await saveInFlightRunCommit(entry, now);
    await saveInFlightRunCommit(newer, now + 1);

    await clearInFlightRunCommit(entry, now + 1);

    await expect(loadInFlightRunCommits(now + 1)).resolves.toEqual([newer]);
    await clearInFlightRunCommit(newer, now + 1);
    await expect(loadInFlightRunCommits(now + 1)).resolves.toEqual([]);
  });

  it('rejects corrupt or oversized metadata and keeps at most sixteen tuples', async () => {
    await fakeBrowser.storage.session.set({
      'grok-run-commit-recovery:reservation:run.storage_1234567890:group-storage-123:42':
        {
          ...entry,
          payload: 'must-not-persist',
        },
    });
    await expect(loadInFlightRunCommits(now)).resolves.toEqual([]);

    for (let index = 0; index < 20; index += 1) {
      await saveInFlightRunCommit(
        {
          lifecycle: 'reservation',
          authorizationId: `authorization_${String(index).padStart(16, '0')}`,
          acceptanceId: `run.storage_${String(index).padStart(16, '0')}`,
          groupId: `group-storage-${index}`,
          tabId: index,
          createdAt: now + index,
        },
        now + index,
      );
    }

    const retained = await loadInFlightRunCommits(now + 20);
    expect(retained).toHaveLength(16);
    expect(retained[0]?.groupId).toBe('group-storage-4');
    expect(retained[15]?.groupId).toBe('group-storage-19');
  });

  it('uses one storage key per tuple so concurrent panels cannot overwrite the shared array', async () => {
    const other: InFlightRunCommit = {
      ...entry,
      authorizationId: 'authorization_0987654321',
      acceptanceId: 'run.storage_0987654321',
      groupId: 'group-storage-456',
      tabId: 43,
    };

    await Promise.all([
      saveInFlightRunCommit(entry, now),
      saveInFlightRunCommit(other, now),
    ]);

    await expect(loadInFlightRunCommits(now)).resolves.toEqual([entry, other]);
    const stored = await fakeBrowser.storage.session.get();
    expect(
      Object.keys(stored).filter((key) =>
        key.startsWith('grok-run-commit-recovery:'),
      ),
    ).toHaveLength(2);
  });
});
