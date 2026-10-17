import { z } from 'zod/mini';

import {
  MAX_PREPARED_IMAGE_DATA_URL_CHARS,
  MAX_UPLOADED_IMAGE_BYTES,
} from '../security/image-limits';
import { isBoundedBase64RasterDataUrl } from '../security/urls';

import { pageStopSchema } from '../protocol/runtime';
import { ASPECT_RATIOS, MODES } from './types';

const logEntrySchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
  timestamp: z.number(),
});

const promptResultSchema = z.looseObject({
  index: z.number().check(z.int()),
  promptIndex: z.number().check(z.int()),
  success: z.boolean(),
  downloadComplete: z.boolean(),
  error: z.optional(z.string()),
});

export const promptGroupSchema = z.looseObject({
  id: z.string().check(z.minLength(1)),
  status: z.enum([
    'queued',
    'running',
    'completed',
    'cancelled',
    'stopped',
    'error',
  ]),
  processedCount: z.number().check(z.int(), z.minimum(0)),
  totalCount: z.number().check(z.int(), z.minimum(0)),
  createdAt: z.number(),
  isCancelling: z.boolean(),
  isActive: z.boolean(),
  delayRemainingSeconds: z.optional(z.number()),
  results: z.array(promptResultSchema),
  currentPromptIndex: z.optional(z.number().check(z.int())),
  stop: z.optional(pageStopSchema),
  promptPreviews: z.array(z.string()),
  promptIndices: z.array(z.number().check(z.int())),
  retryCountByIndex: z.record(
    z.string(),
    z.number().check(z.int(), z.minimum(0)),
  ),
  downloadRetryCountByIndex: z.record(
    z.string(),
    z.number().check(z.int(), z.minimum(0)),
  ),
});

export const runtimeMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ACTION_LOG'),
    data: logEntrySchema,
  }),
  z.object({
    type: z.literal('VIDEO_GENERATION_PROGRESS'),
    data: z.looseObject({
      groupId: z.string().check(z.minLength(1)),
      promptIndex: z.number().check(z.int()),
      percentage: z.number().check(z.minimum(0), z.maximum(100)),
      status: z.string(),
      prompt: z.optional(z.string()),
    }),
  }),
  z.object({ type: z.literal('CONTENT_SCRIPT_RESET') }),
  z.object({
    type: z.literal('PROMPT_GROUP_STATUS'),
    data: promptGroupSchema,
  }),
]);

export const uploadedImageSchema = z.object({
  id: z.string().check(z.minLength(1)),
  name: z.string().check(z.minLength(1), z.maxLength(255)),
  base64: z.string().check(
    z.minLength(1),
    z.maxLength(MAX_PREPARED_IMAGE_DATA_URL_CHARS),
    z.refine(
      (value) => isBoundedBase64RasterDataUrl(value, MAX_UPLOADED_IMAGE_BYTES),
      'Uploaded image must be a bounded raster data URL',
    ),
  ),
  uploadedAt: z.number(),
});

export const promptPayloadSchema = z.looseObject({
  prompt: z.string().check(z.minLength(1)),
  mode: z.enum(MODES),
  aspectRatio: z.enum(ASPECT_RATIOS),
  outputCount: z.number().check(z.int(), z.minimum(1)),
  promptIndex: z.number().check(z.int(), z.minimum(1)),
  autoDownloadResourceQuality: z.string(),
  concurrentPrompts: z.number().check(z.int(), z.minimum(1)),
  promptDelaySecondsMin: z.number().check(z.minimum(0)),
  promptDelaySecondsMax: z.number().check(z.minimum(0)),
  isConcat: z.boolean(),
  maxRetries: z.number().check(z.int(), z.minimum(0)),
  autoChangeFileName: z.boolean(),
  folderName: z.string(),
  videoOption: z.optional(z.string()),
  imageModel: z.optional(z.enum(['speed', 'quality'])),
  images: z.optional(z.array(uploadedImageSchema)),
  imageIds: z.optional(z.array(z.string())),
});

export const operationResponseSchema = z.looseObject({
  success: z.boolean(),
  error: z.optional(z.string()),
  groupId: z.optional(z.string()),
});

export const checkGrokPageResponseSchema = z.looseObject({
  isGrokPage: z.boolean(),
  health: z.optional(
    z.looseObject({
      ok: z.boolean(),
      missing: z.array(z.string()),
      revision: z.string(),
    }),
  ),
  stop: z.optional(pageStopSchema),
});
