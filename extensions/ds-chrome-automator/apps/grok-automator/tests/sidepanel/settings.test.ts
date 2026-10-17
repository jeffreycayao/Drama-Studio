import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  migrateSettings,
  normalizeSettings,
} from '../../src/sidepanel/settings';

describe('side-panel settings', () => {
  it('returns current defaults when no prior settings exist', () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('applies all five recovered migrations', () => {
    const migrated = migrateSettings({
      ...DEFAULT_SETTINGS,
      migrationVersion: 0,
      autoDownloadVideoQuality: '480p',
      promptDelaySecondsMin: 2,
      promptDelaySecondsMax: 3,
      imageModel: 'speed',
      imageOutputCount: 1,
      defaultImageOption: 'concat',
    });

    expect(migrated).toMatchObject({
      migrationVersion: 5,
      autoDownloadVideoQuality: '480p-upscale',
      promptDelaySecondsMin: 30,
      promptDelaySecondsMax: 45,
      imageModel: 'quality',
      imageOutputCount: 4,
      defaultImageOption: 'new-image-concat',
    });
  });

  it('rejects out-of-contract settings at the validation boundary', () => {
    expect(() =>
      normalizeSettings({ ...DEFAULT_SETTINGS, concurrentPrompts: 999 }),
    ).toThrow();
  });

  it('supports up to twelve image outputs', () => {
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, imageOutputCount: 12 })
        .imageOutputCount,
    ).toBe(12);
    expect(() =>
      normalizeSettings({ ...DEFAULT_SETTINGS, imageOutputCount: 13 }),
    ).toThrow();
  });

  it('requires between one and twenty retries', () => {
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, maxRetries: 1 }).maxRetries,
    ).toBe(1);
    expect(
      normalizeSettings({ ...DEFAULT_SETTINGS, maxRetries: 20 }).maxRetries,
    ).toBe(20);
    expect(() =>
      normalizeSettings({ ...DEFAULT_SETTINGS, maxRetries: 0 }),
    ).toThrow();
    expect(() =>
      normalizeSettings({ ...DEFAULT_SETTINGS, maxRetries: 21 }),
    ).toThrow();
  });

  it('drops the retired video model while migrating legacy settings', () => {
    const migrated = migrateSettings({
      ...DEFAULT_SETTINGS,
      videoModel: 'Legacy default',
    });

    expect(migrated).not.toHaveProperty('videoModel');
  });

  it('throws for corrupt persisted settings instead of silently resetting', () => {
    expect(() =>
      migrateSettings({ ...DEFAULT_SETTINGS, maxRetries: 0 }),
    ).toThrow();
    expect(() => migrateSettings('invalid')).toThrow();
  });
});
