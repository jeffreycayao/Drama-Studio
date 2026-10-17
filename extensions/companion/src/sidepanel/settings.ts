import { z } from 'zod/mini';

import {
  ASPECT_RATIOS,
  IMAGE_OPTIONS,
  MODES,
  VIDEO_OPTIONS,
  type Settings,
} from './types';

export const SETTINGS_MIGRATION_VERSION = 5 as const;

export const DEFAULT_SETTINGS: Settings = {
  migrationVersion: SETTINGS_MIGRATION_VERSION,
  defaultMode: 'textToVideo',
  aspectRatio: '16:9',
  concurrentPrompts: 1,
  outputCount: 1,
  imageOutputCount: 4,
  promptDelaySecondsMin: 20,
  promptDelaySecondsMax: 30,
  imageModel: 'quality',
  defaultVideoOption: '6s',
  defaultImageOption: 'new-image',
  imageToVideoMaxImagesPerPrompt: 1,
  componentsToVideoMaxImagesPerPrompt: 3,
  imageToImageMaxImagesPerPrompt: 3,
  maxRetries: 5,
  autoDownloadVideoQuality: '480p-upscale',
  autoDownloadImageQuality: '1k',
  autoAddCharacterImages: false,
  autoChangeFileName: true,
  folderName: 'grok-folder-1',
  hideTipBeforeUse: false,
};

export const settingsSchema = z.object({
  migrationVersion: z.literal(SETTINGS_MIGRATION_VERSION),
  defaultMode: z.enum(MODES),
  aspectRatio: z.enum(ASPECT_RATIOS),
  concurrentPrompts: z.number().check(z.int(), z.minimum(1), z.maximum(10)),
  outputCount: z.number().check(z.int(), z.minimum(1), z.maximum(4)),
  imageOutputCount: z.number().check(z.int(), z.minimum(1), z.maximum(12)),
  promptDelaySecondsMin: z
    .number()
    .check(z.int(), z.minimum(0), z.maximum(600)),
  promptDelaySecondsMax: z
    .number()
    .check(z.int(), z.minimum(0), z.maximum(600)),
  imageModel: z.enum(['speed', 'quality']),
  defaultVideoOption: z.enum(VIDEO_OPTIONS),
  defaultImageOption: z.enum(IMAGE_OPTIONS),
  imageToVideoMaxImagesPerPrompt: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(10)),
  componentsToVideoMaxImagesPerPrompt: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(10)),
  imageToImageMaxImagesPerPrompt: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(10)),
  maxRetries: z.number().check(z.int(), z.minimum(1), z.maximum(20)),
  autoDownloadVideoQuality: z.string().check(z.minLength(1), z.maxLength(100)),
  autoDownloadImageQuality: z.string().check(z.minLength(1), z.maxLength(100)),
  autoAddCharacterImages: z.boolean(),
  autoChangeFileName: z.boolean(),
  folderName: z.string().check(z.maxLength(120)),
  hideTipBeforeUse: z.boolean(),
});

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}

/** Applies the five recovered migrations, then validates every persisted field. */
export function migrateSettings(value: unknown): Settings {
  if (value === null || value === undefined) return { ...DEFAULT_SETTINGS };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored settings must be an object');
  }
  const persisted = asRecord(value);
  const rawVersion =
    typeof persisted.migrationVersion === 'number'
      ? persisted.migrationVersion
      : 0;

  if (rawVersion < 1 && persisted.autoDownloadVideoQuality === '480p') {
    persisted.autoDownloadVideoQuality = '480p-upscale';
  }
  if (rawVersion < 2) {
    persisted.promptDelaySecondsMin = 30;
    persisted.promptDelaySecondsMax = 45;
  }
  if (rawVersion < 3) persisted.imageModel = 'quality';
  if (rawVersion < 4) persisted.imageOutputCount = 4;
  if (rawVersion < 5 && persisted.defaultImageOption === 'concat') {
    persisted.defaultImageOption = 'new-image-concat';
  }

  delete persisted.videoModel;
  persisted.migrationVersion = SETTINGS_MIGRATION_VERSION;
  const candidate = { ...DEFAULT_SETTINGS, ...persisted };
  return settingsSchema.parse(candidate);
}

export function normalizeSettings(value: unknown): Settings {
  return settingsSchema.parse(value);
}
