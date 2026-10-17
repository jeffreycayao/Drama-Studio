import { z } from 'zod/mini';

import {
  isAllowedGeneratedResourceUrl,
  isBoundedBase64RasterDataUrl,
} from '../security/urls';
import {
  IMAGE_CHUNK_CHAR_LIMIT,
  MAX_IMAGE_TRANSFER_CHUNKS,
  MAX_PREPARED_IMAGE_DATA_URL_CHARS,
  MAX_UPLOADED_IMAGE_BYTES,
  MAX_UPLOADED_IMAGE_FILES,
} from '../security/image-limits';

const nonEmptyString = z.string().check(z.minLength(1));
const positiveInteger = z.int().check(z.positive());
const nonNegativeInteger = z.int().check(z.nonnegative());
const nonNegativeNumber = z.number().check(z.nonnegative());
const acceptanceIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));

const preparedImageDataUrlSchema = z.string().check(
  z.minLength(1),
  z.maxLength(MAX_PREPARED_IMAGE_DATA_URL_CHARS),
  z.refine(
    (value) => isBoundedBase64RasterDataUrl(value, MAX_UPLOADED_IMAGE_BYTES),
    'Prepared image must be a bounded raster data URL',
  ),
);

export const preparedImageSchema = z.object({
  base64: preparedImageDataUrlSchema,
  name: z.optional(z.string().check(z.maxLength(255))),
});

export const previousPromptOutputSchema = z.object({
  nextPromptExtendVideo: z.optional(z.boolean()),
  nextPromptEditImage: z.optional(z.boolean()),
  extractedFrame: z.optional(preparedImageDataUrlSchema),
});

export const promptModeSchema = z.enum([
  'textToVideo',
  'imageToVideo',
  'componentsToVideo',
  'textToImage',
  'imageToImage',
]);

export const promptPayloadSchema = z.object({
  prompt: z.string(),
  promptIndex: positiveInteger,
  mode: promptModeSchema,
  aspectRatio: z.string(),
  outputCount: positiveInteger,
  folderName: z.string(),
  imageIds: z.optional(
    z.array(nonEmptyString).check(z.maxLength(MAX_UPLOADED_IMAGE_FILES)),
  ),
  images: z.optional(
    z.array(preparedImageSchema).check(z.maxLength(MAX_UPLOADED_IMAGE_FILES)),
  ),
  imageModel: z.optional(z.enum(['speed', 'quality'])),
  videoOption: z.optional(z.string()),
  autoDownloadResourceQuality: z.string(),
  autoChangeFileName: z.optional(z.boolean()),
  maxRetries: z.optional(nonNegativeInteger),
  isConcat: z.optional(z.boolean()),
  groupId: z.optional(nonEmptyString),
  outputPreviousPrompt: z.optional(previousPromptOutputSchema),
});

export const prepareImageMessageSchema = z.object({
  type: z.literal('PREPARE_IMAGE'),
  id: z.string().check(z.minLength(1), z.maxLength(128)),
  data: preparedImageSchema,
});

export const prepareImageChunkMessageSchema = z.object({
  type: z.literal('PREPARE_IMAGE_CHUNK'),
  id: z.string().check(z.minLength(1), z.maxLength(128)),
  chunk: z.string().check(z.minLength(1), z.maxLength(IMAGE_CHUNK_CHAR_LIMIT)),
  chunkIndex: nonNegativeInteger.check(
    z.maximum(MAX_IMAGE_TRANSFER_CHUNKS - 1),
  ),
  totalChunks: positiveInteger.check(z.maximum(MAX_IMAGE_TRANSFER_CHUNKS)),
});

export const autoFillGrokMessageSchema = z.object({
  type: z.literal('AUTO_FILL_GROK'),
  payloads: z
    .array(promptPayloadSchema)
    .check(z.minLength(1), z.maxLength(1_000)),
  acceptanceId: acceptanceIdSchema,
  groupId: z.optional(nonEmptyString),
  concurrentPrompts: z.optional(positiveInteger),
  promptDelaySecondsMin: z.optional(nonNegativeNumber),
  promptDelaySecondsMax: z.optional(nonNegativeNumber),
});

export const contentRequestSchema = z.discriminatedUnion('type', [
  prepareImageMessageSchema,
  prepareImageChunkMessageSchema,
  autoFillGrokMessageSchema,
  z.object({
    type: z.literal('COMMIT_PROMPT_GROUP'),
    groupId: nonEmptyString,
    acceptanceId: acceptanceIdSchema,
  }),
  z.object({
    type: z.literal('QUERY_PROMPT_GROUP_COMMIT'),
    groupId: nonEmptyString,
    acceptanceId: acceptanceIdSchema,
  }),
  z.object({
    type: z.literal('RELEASE_PROMPT_GROUP'),
    groupId: nonEmptyString,
    acceptanceId: acceptanceIdSchema,
  }),
  z.object({
    type: z.literal('CANCEL_PROMPT_GROUP'),
    groupId: nonEmptyString,
    acceptanceId: z.optional(acceptanceIdSchema),
  }),
  z.object({ type: z.literal('CHECK_GROK_PAGE') }),
]);

export const selectorConfigSchema = z.object({
  imagineLink: nonEmptyString,
  videoModeButton: nonEmptyString,
  imageModeButton: nonEmptyString,
  imageSpeedModel: nonEmptyString,
  imageQualityModel: nonEmptyString,
  aspectRatioButton: nonEmptyString,
  aspectRatioTemplateV3: nonEmptyString,
  numberOfImagesOutputButton: nonEmptyString,
  numberOfImagesOutputTemplate: nonEmptyString,
  videoQuality480pItem: nonEmptyString,
  videoQuality720pItem: nonEmptyString,
  videoQuality1080pItem: nonEmptyString,
  videoLength6sItem: nonEmptyString,
  videoLength10sItem: nonEmptyString,
  videoLength15sItem: nonEmptyString,
  plusImageButton: nonEmptyString,
  fileInput: nonEmptyString,
  promptContentEditable: nonEmptyString,
  promptDropUiTextarea: nonEmptyString,
  imageUploading: nonEmptyString,
  imageUploadFailed: nonEmptyString,
  removeFailedUploadedImage: nonEmptyString,
  submitButton: nonEmptyString,
  comparisonImage: nonEmptyString,
  ignoreComparisonImageButton: nonEmptyString,
  generateVideoButton: nonEmptyString,
  mainArticle: nonEmptyString,
  generatedImageItem: nonEmptyString,
  shareButton: nonEmptyString,
  moreOptionsButton: nonEmptyString,
  extendVideoMenuItem: z.optional(nonEmptyString),
  upscaleMenuItem: nonEmptyString,
  upscale720pOption: nonEmptyString,
  upscale1080pOption: nonEmptyString,
  hdButton: nonEmptyString,
  downloadButton: nonEmptyString,
  percentageSvg: nonEmptyString,
  percentageSpan: nonEmptyString,
});

export const automationConfigSchema = z.object({
  version: z.string(),
  hash: z.string(),
  selectors: selectorConfigSchema,
});

export const automationStepSchema = z.object({
  name: nonEmptyString,
  status: z.enum(['pending', 'running', 'completed', 'error']),
  error: z.optional(z.string()),
});

export const promptResultSchema = z.object({
  index: z.number(),
  promptIndex: z.number(),
  success: z.boolean(),
  downloadComplete: z.boolean(),
  steps: z.optional(z.array(automationStepSchema)),
  error: z.optional(z.string()),
  cancelled: z.optional(z.boolean()),
});

export const downloadResponseSchema = z.object({
  success: z.boolean(),
  downloadId: z.optional(z.number()),
  error: z.optional(z.string()),
  retryable: z.optional(z.boolean()),
});

export const domResourceSourceSchema = z
  .string()
  .check(
    z.minLength(1),
    z.refine(isAllowedGeneratedResourceUrl, 'Unsupported generated media URL'),
  );

export type PreparedImage = z.infer<typeof preparedImageSchema>;
export type PreviousPromptOutput = z.infer<typeof previousPromptOutputSchema>;
export type PromptMode = z.infer<typeof promptModeSchema>;
export type PromptPayload = z.infer<typeof promptPayloadSchema>;
export type AutoFillGrokMessage = z.infer<typeof autoFillGrokMessageSchema>;
export type ContentRequest = z.infer<typeof contentRequestSchema>;
export type SelectorConfig = z.infer<typeof selectorConfigSchema>;
export type AutomationConfig = z.infer<typeof automationConfigSchema>;
export type AutomationStep = z.infer<typeof automationStepSchema>;
export type PromptResult = z.infer<typeof promptResultSchema>;
