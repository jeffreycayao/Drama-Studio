import { z } from 'zod/mini';

import {
  MAX_PREPARED_IMAGE_TOTAL_CHARS,
  MAX_UPLOADED_IMAGE_FILES,
} from '../security/image-limits';
import {
  preparedImageSchema,
  promptPayloadSchema,
  type PreparedImage,
  type PromptPayload,
} from './content';

export const MAX_BLOCKED_PROMPT_STAGES = 4;
export const BLOCKED_PROMPT_STAGE_TTL_MS = 5 * 60_000 + 10_000;
export const MAX_BLOCKED_STAGE_PROMPTS = 1_000;
export const MAX_BLOCKED_STAGE_PROMPT_CHARS = 5_000_000;
export const MAX_BLOCKED_STAGE_SERIALIZED_CHARS =
  MAX_PREPARED_IMAGE_TOTAL_CHARS + MAX_BLOCKED_STAGE_PROMPT_CHARS + 1_048_576;
export const MAX_BLOCKED_STAGE_AGGREGATE_CHARS = 128 * 1_024 * 1_024;
export const BLOCKED_STAGE_CHUNK_CHAR_LIMIT = 1_048_576;
export const MAX_BLOCKED_STAGE_TRANSFER_CHUNKS = Math.ceil(
  MAX_BLOCKED_STAGE_SERIALIZED_CHARS / BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
);
export const MAX_CONCURRENT_BLOCKED_STAGE_TRANSFERS = 2;
export const BLOCKED_STAGE_TRANSFER_TIMEOUT_MS = 60_000;

const boundedIdentifierSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));
const acceptanceIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));
const nonNegativeInteger = z.number().check(z.int(), z.nonnegative());
const tabIdSchema = z
  .number()
  .check(z.int(), z.minimum(0), z.maximum(2_147_483_647));

const promptStageInputShape = {
  schemaVersion: z.literal(1),
  groupId: boundedIdentifierSchema,
  acceptanceId: acceptanceIdSchema,
  createdAt: nonNegativeInteger,
  payloads: z
    .array(promptPayloadSchema)
    .check(z.minLength(1), z.maxLength(MAX_BLOCKED_STAGE_PROMPTS)),
  preparedImages: z.record(boundedIdentifierSchema, preparedImageSchema),
  concurrentPrompts: z.number().check(z.int(), z.minimum(1), z.maximum(10)),
  promptDelaySecondsMin: z.number().check(z.minimum(0), z.maximum(600)),
  promptDelaySecondsMax: z.number().check(z.minimum(0), z.maximum(600)),
};

export const blockedPromptStageInputSchema = z.strictObject(
  promptStageInputShape,
);

export const blockedPromptStageSchema = z.strictObject({
  ...promptStageInputShape,
  tabId: tabIdSchema,
  phase: z.enum(['blocked', 'released', 'claimed']),
  expiresAt: nonNegativeInteger,
  serializedChars: z
    .number()
    .check(
      z.int(),
      z.minimum(1),
      z.maximum(MAX_BLOCKED_STAGE_SERIALIZED_CHARS),
    ),
});

export const blockedPromptStageReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  groupId: boundedIdentifierSchema,
  acceptanceId: acceptanceIdSchema,
  tabId: tabIdSchema,
  phase: z.literal('claimed'),
  recordedAt: nonNegativeInteger,
  expiresAt: nonNegativeInteger,
});

export const blockedPromptStageManifestSchema = z.strictObject({
  groupId: boundedIdentifierSchema,
  acceptanceId: acceptanceIdSchema,
  phase: z.enum(['blocked', 'released', 'claimed']),
  serializedChars: z.number().check(z.int(), z.nonnegative()),
  totalChunks: z
    .number()
    .check(
      z.int(),
      z.nonnegative(),
      z.maximum(MAX_BLOCKED_STAGE_TRANSFER_CHUNKS),
    ),
});

export const blockedPromptStageStatusSchema = z.enum([
  'blocked',
  'released',
  'claimed',
  'missing',
]);

export type BlockedPromptStageInput = z.infer<
  typeof blockedPromptStageInputSchema
>;
export type BlockedPromptStage = z.infer<typeof blockedPromptStageSchema>;
export type BlockedPromptStageReceipt = z.infer<
  typeof blockedPromptStageReceiptSchema
>;
export type BlockedPromptStageManifest = z.infer<
  typeof blockedPromptStageManifestSchema
>;
export type BlockedPromptStageStatus = z.infer<
  typeof blockedPromptStageStatusSchema
>;
export interface BlockedPromptStageClaimResult {
  status: BlockedPromptStageStatus;
  newlyClaimed: boolean;
}

export function estimateBlockedPromptStageChars(
  input: BlockedPromptStageInput,
): number {
  let total =
    input.groupId.length +
    input.acceptanceId.length +
    Object.keys(input.preparedImages).reduce(
      (sum, imageId) => sum + imageId.length,
      0,
    );
  for (const payload of input.payloads) {
    total +=
      payload.prompt.length +
      payload.aspectRatio.length +
      payload.mode.length +
      payload.folderName.length +
      payload.autoDownloadResourceQuality.length +
      (payload.videoOption?.length ?? 0) +
      (payload.imageModel?.length ?? 0) +
      (payload.groupId?.length ?? 0) +
      (payload.imageIds?.reduce((sum, id) => sum + id.length, 0) ?? 0) +
      (payload.outputPreviousPrompt?.extractedFrame?.length ?? 0) +
      256;
  }
  for (const image of Object.values(input.preparedImages)) {
    total += image.base64.length + (image.name?.length ?? 0) + 64;
  }
  return total;
}

export function validateBlockedPromptStageInput(
  value: unknown,
): BlockedPromptStageInput {
  const input = blockedPromptStageInputSchema.parse(value);
  const promptChars = input.payloads.reduce(
    (sum, payload) => sum + payload.prompt.length,
    0,
  );
  if (promptChars > MAX_BLOCKED_STAGE_PROMPT_CHARS) {
    throw new Error('Blocked prompt stage exceeds the prompt text limit');
  }
  const images = Object.values(input.preparedImages);
  if (images.length > MAX_UPLOADED_IMAGE_FILES) {
    throw new Error('Blocked prompt stage has too many prepared images');
  }
  const imageChars = images.reduce(
    (sum, image) => sum + image.base64.length,
    0,
  );
  if (imageChars > MAX_PREPARED_IMAGE_TOTAL_CHARS) {
    throw new Error('Blocked prompt stage exceeds the prepared image limit');
  }
  for (const payload of input.payloads) {
    if (payload.images !== undefined) {
      throw new Error('Blocked prompt stages must deduplicate prepared images');
    }
    for (const imageId of payload.imageIds ?? []) {
      if (!input.preparedImages[imageId]) {
        throw new Error('Blocked prompt stage references a missing image');
      }
    }
  }
  if (
    estimateBlockedPromptStageChars(input) > MAX_BLOCKED_STAGE_SERIALIZED_CHARS
  ) {
    throw new Error('Blocked prompt stage exceeds the durable storage limit');
  }
  return input;
}

export function stagePayloadsWithoutPreparedImages(
  payloads: PromptPayload[],
): PromptPayload[] {
  return payloads.map((payload) => {
    const staged = { ...payload };
    delete staged.images;
    return staged;
  });
}

export function resolveBlockedStagePayloads(
  stage: Pick<BlockedPromptStage, 'payloads' | 'preparedImages'>,
): PromptPayload[] {
  return stage.payloads.map((payload) => {
    const images = payload.imageIds?.flatMap((imageId) => {
      const image: PreparedImage | undefined = stage.preparedImages[imageId];
      return image ? [image] : [];
    });
    return {
      ...payload,
      ...(images && images.length > 0 ? { images } : {}),
    };
  });
}
