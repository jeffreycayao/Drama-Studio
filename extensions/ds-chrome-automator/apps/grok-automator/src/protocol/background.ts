import { z } from 'zod/mini';

import { isAllowedGeneratedResourceUrl } from '../security/urls';
import {
  BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
  MAX_BLOCKED_STAGE_TRANSFER_CHUNKS,
} from './prompt-stage';

const boundedStageIdentifierSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));
const stageAcceptanceIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));
const promptStageIdentityShape = {
  groupId: boundedStageIdentifierSchema,
  acceptanceId: stageAcceptanceIdSchema,
};

export const backgroundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_REMOTE_CONFIG') }),
  z.object({
    type: z.literal('SET_ZOOM'),
    zoomFactor: z.number().check(z.positive()),
  }),
  z.object({
    type: z.literal('DOWNLOAD_RESOURCE'),
    url: z
      .string()
      .check(
        z.minLength(1),
        z.refine(
          isAllowedGeneratedResourceUrl,
          'Unsupported generated media URL',
        ),
      ),
    filename: z.string().check(z.minLength(1)),
    folder: z.optional(z.string()),
    autoChangeFileName: z.optional(z.boolean()),
  }),
  z.object({
    type: z.literal('SET_FOLDER_NAME'),
    folderName: z.optional(z.string()),
    prefix: z.optional(z.string()),
    autoChangeFileName: z.optional(z.boolean()),
  }),
  z.object({
    type: z.literal('PROMPT_GROUP_STATUS'),
    data: z.optional(
      z.looseObject({
        status: z.enum([
          'queued',
          'running',
          'completed',
          'cancelled',
          'error',
        ]),
      }),
    ),
  }),
  z.strictObject({
    type: z.literal('STORE_BLOCKED_PROMPT_STAGE_CHUNK'),
    ...promptStageIdentityShape,
    chunk: z
      .string()
      .check(z.minLength(1), z.maxLength(BLOCKED_STAGE_CHUNK_CHAR_LIMIT)),
    chunkIndex: z
      .number()
      .check(
        z.int(),
        z.nonnegative(),
        z.maximum(MAX_BLOCKED_STAGE_TRANSFER_CHUNKS - 1),
      ),
    totalChunks: z
      .number()
      .check(
        z.int(),
        z.minimum(1),
        z.maximum(MAX_BLOCKED_STAGE_TRANSFER_CHUNKS),
      ),
  }),
  z.strictObject({ type: z.literal('LIST_BLOCKED_PROMPT_STAGES') }),
  z.strictObject({
    type: z.literal('READ_BLOCKED_PROMPT_STAGE_CHUNK'),
    ...promptStageIdentityShape,
    chunkIndex: z
      .number()
      .check(
        z.int(),
        z.nonnegative(),
        z.maximum(MAX_BLOCKED_STAGE_TRANSFER_CHUNKS - 1),
      ),
  }),
  z.strictObject({
    type: z.literal('GET_BLOCKED_PROMPT_STAGE_STATUS'),
    ...promptStageIdentityShape,
  }),
  z.strictObject({
    type: z.literal('MARK_BLOCKED_PROMPT_STAGE_RELEASED'),
    ...promptStageIdentityShape,
  }),
  z.strictObject({
    type: z.literal('MARK_BLOCKED_PROMPT_STAGE_CLAIMED'),
    ...promptStageIdentityShape,
  }),
  z.strictObject({
    type: z.literal('ACK_BLOCKED_PROMPT_STAGE_RELEASED'),
    ...promptStageIdentityShape,
  }),
  z.strictObject({
    type: z.literal('DISCARD_BLOCKED_PROMPT_STAGE'),
    ...promptStageIdentityShape,
  }),
]);

export type BackgroundMessage = z.infer<typeof backgroundMessageSchema>;
