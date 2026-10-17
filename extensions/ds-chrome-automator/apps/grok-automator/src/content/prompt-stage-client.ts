import { z } from 'zod/mini';

import {
  BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
  BLOCKED_STAGE_TRANSFER_TIMEOUT_MS,
  MAX_BLOCKED_STAGE_SERIALIZED_CHARS,
  MAX_BLOCKED_STAGE_TRANSFER_CHUNKS,
  blockedPromptStageManifestSchema,
  blockedPromptStageSchema,
  blockedPromptStageStatusSchema,
  validateBlockedPromptStageInput,
  type BlockedPromptStage,
  type BlockedPromptStageClaimResult,
  type BlockedPromptStageInput,
  type BlockedPromptStageManifest,
  type BlockedPromptStageStatus,
} from '../protocol/prompt-stage';

const operationResponseSchema = z.strictObject({
  success: z.boolean(),
  error: z.optional(z.string()),
  acceptanceId: z.optional(z.string()),
});
const statusResponseSchema = z.strictObject({
  success: z.literal(true),
  status: blockedPromptStageStatusSchema,
  acceptanceId: z.string(),
});
const claimResponseSchema = z.strictObject({
  success: z.literal(true),
  status: blockedPromptStageStatusSchema,
  newlyClaimed: z.boolean(),
  acceptanceId: z.string(),
});
const storeChunkResponseSchema = z.strictObject({
  success: z.literal(true),
  stored: z.boolean(),
  status: z.optional(blockedPromptStageStatusSchema),
  acceptanceId: z.optional(z.string()),
  receivedCount: z.optional(z.number().check(z.int(), z.nonnegative())),
  totalChunks: z.optional(z.number().check(z.int(), z.minimum(1))),
});
const manifestListResponseSchema = z.strictObject({
  success: z.literal(true),
  stages: z.array(blockedPromptStageManifestSchema),
});
const readChunkResponseSchema = z.strictObject({
  success: z.literal(true),
  chunk: z
    .string()
    .check(z.minLength(1), z.maxLength(BLOCKED_STAGE_CHUNK_CHAR_LIMIT)),
  totalChunks: z
    .number()
    .check(z.int(), z.minimum(1), z.maximum(MAX_BLOCKED_STAGE_TRANSFER_CHUNKS)),
});

const MESSAGE_TIMEOUT_MS = 5_000;
const STORE_ATTEMPT_LIMIT = 2;

export interface PromptStageClient {
  store: (input: BlockedPromptStageInput) => Promise<BlockedPromptStageStatus>;
  status: (
    groupId: string,
    acceptanceId: string,
  ) => Promise<BlockedPromptStageStatus>;
  list: () => Promise<BlockedPromptStageManifest[]>;
  read: (
    groupId: string,
    acceptanceId: string,
    manifest?: BlockedPromptStageManifest,
  ) => Promise<BlockedPromptStage | null>;
  markReleased: (
    groupId: string,
    acceptanceId: string,
  ) => Promise<BlockedPromptStageStatus>;
  claim: (
    groupId: string,
    acceptanceId: string,
  ) => Promise<BlockedPromptStageClaimResult>;
  acknowledgeReleased: (groupId: string, acceptanceId: string) => Promise<void>;
  discard: (groupId: string, acceptanceId: string) => Promise<void>;
}

function sendBackgroundMessage(
  message: unknown,
  timeoutMs = MESSAGE_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Blocked prompt stage storage did not respond in time'));
    }, timeoutMs);
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(
          new Error(
            runtimeError.message ?? 'Blocked prompt stage storage failed',
          ),
        );
        return;
      }
      resolve(response);
    });
  });
}

function remainingTransferTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error('Blocked prompt stage transfer exceeded its deadline');
  }
  return Math.min(MESSAGE_TIMEOUT_MS, remaining);
}

function parseOperation(response: unknown): void {
  const parsed = operationResponseSchema.safeParse(response);
  if (!parsed.success || !parsed.data.success) {
    throw new Error(
      parsed.success
        ? (parsed.data.error ?? 'Blocked prompt stage operation failed')
        : 'Invalid blocked prompt stage response',
    );
  }
}

export function createPromptStageClient(): PromptStageClient {
  const status: PromptStageClient['status'] = async (groupId, acceptanceId) => {
    const response = statusResponseSchema.safeParse(
      await sendBackgroundMessage({
        type: 'GET_BLOCKED_PROMPT_STAGE_STATUS',
        groupId,
        acceptanceId,
      }),
    );
    if (!response.success || response.data.acceptanceId !== acceptanceId) {
      throw new Error('Invalid blocked prompt stage status response');
    }
    return response.data.status;
  };

  return {
    status,
    store: async (rawInput) => {
      const input = validateBlockedPromptStageInput(rawInput);
      const existing = await status(input.groupId, input.acceptanceId);
      if (existing !== 'missing') return existing;
      const serialized = JSON.stringify(input);
      if (
        serialized.length < 1 ||
        serialized.length > MAX_BLOCKED_STAGE_SERIALIZED_CHARS
      ) {
        throw new Error('Blocked prompt stage exceeds the transfer limit');
      }
      const totalChunks = Math.ceil(
        serialized.length / BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
      );
      if (totalChunks > MAX_BLOCKED_STAGE_TRANSFER_CHUNKS) {
        throw new Error('Blocked prompt stage requires too many chunks');
      }
      const deadline = Date.now() + BLOCKED_STAGE_TRANSFER_TIMEOUT_MS;
      let lastError: Error = new Error('Blocked prompt stage was not stored');
      for (let attempt = 0; attempt < STORE_ATTEMPT_LIMIT; attempt += 1) {
        try {
          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
            const response = storeChunkResponseSchema.safeParse(
              await sendBackgroundMessage(
                {
                  type: 'STORE_BLOCKED_PROMPT_STAGE_CHUNK',
                  groupId: input.groupId,
                  acceptanceId: input.acceptanceId,
                  chunk: serialized.slice(
                    chunkIndex * BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
                    (chunkIndex + 1) * BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
                  ),
                  chunkIndex,
                  totalChunks,
                },
                remainingTransferTime(deadline),
              ),
            );
            if (!response.success) {
              throw new Error('Invalid blocked prompt stage chunk response');
            }
            if (
              response.data.acceptanceId !== undefined &&
              response.data.acceptanceId !== input.acceptanceId
            ) {
              throw new Error('Blocked prompt stage acceptance did not match');
            }
          }
          const storedStatus = await status(input.groupId, input.acceptanceId);
          if (storedStatus === 'blocked' || storedStatus === 'released') {
            return storedStatus;
          }
          lastError = new Error('Blocked prompt stage was not stored');
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error('Blocked prompt stage was not stored');
        }
      }
      throw lastError;
    },
    list: async () => {
      const response = manifestListResponseSchema.safeParse(
        await sendBackgroundMessage({ type: 'LIST_BLOCKED_PROMPT_STAGES' }),
      );
      if (!response.success) {
        throw new Error('Invalid blocked prompt stage manifest response');
      }
      return response.data.stages;
    },
    read: async (groupId, acceptanceId, providedManifest) => {
      const manifest =
        providedManifest ??
        (await (async () => {
          const manifests = await createPromptStageClient().list();
          return manifests.find(
            (candidate) =>
              candidate.groupId === groupId &&
              candidate.acceptanceId === acceptanceId,
          );
        })());
      if (!manifest) return null;
      if (
        manifest.groupId !== groupId ||
        manifest.acceptanceId !== acceptanceId ||
        manifest.serializedChars < 1 ||
        manifest.serializedChars > MAX_BLOCKED_STAGE_SERIALIZED_CHARS
      ) {
        throw new Error('Blocked prompt stage manifest did not match');
      }
      const deadline = Date.now() + BLOCKED_STAGE_TRANSFER_TIMEOUT_MS;
      const chunks: string[] = [];
      let totalChars = 0;
      for (
        let chunkIndex = 0;
        chunkIndex < manifest.totalChunks;
        chunkIndex += 1
      ) {
        const response = readChunkResponseSchema.safeParse(
          await sendBackgroundMessage(
            {
              type: 'READ_BLOCKED_PROMPT_STAGE_CHUNK',
              groupId,
              acceptanceId,
              chunkIndex,
            },
            remainingTransferTime(deadline),
          ),
        );
        if (
          !response.success ||
          response.data.totalChunks !== manifest.totalChunks
        ) {
          throw new Error('Invalid blocked prompt stage chunk response');
        }
        totalChars += response.data.chunk.length;
        if (totalChars > manifest.serializedChars) {
          throw new Error('Blocked prompt stage exceeded its manifest size');
        }
        chunks.push(response.data.chunk);
      }
      const serialized = chunks.join('');
      if (serialized.length !== manifest.serializedChars) {
        throw new Error(
          'Blocked prompt stage length did not match its manifest',
        );
      }
      const parsedJson: unknown = JSON.parse(serialized);
      const stage = blockedPromptStageSchema.parse(parsedJson);
      if (
        stage.groupId !== groupId ||
        stage.acceptanceId !== acceptanceId ||
        stage.phase !== manifest.phase
      ) {
        throw new Error('Blocked prompt stage identity did not match');
      }
      return stage;
    },
    markReleased: async (groupId, acceptanceId) => {
      const response = statusResponseSchema.safeParse(
        await sendBackgroundMessage({
          type: 'MARK_BLOCKED_PROMPT_STAGE_RELEASED',
          groupId,
          acceptanceId,
        }),
      );
      if (!response.success || response.data.acceptanceId !== acceptanceId) {
        throw new Error('Invalid blocked prompt stage release response');
      }
      return response.data.status;
    },
    claim: async (groupId, acceptanceId) => {
      const response = claimResponseSchema.safeParse(
        await sendBackgroundMessage({
          type: 'MARK_BLOCKED_PROMPT_STAGE_CLAIMED',
          groupId,
          acceptanceId,
        }),
      );
      if (!response.success || response.data.acceptanceId !== acceptanceId) {
        throw new Error('Invalid blocked prompt stage claim response');
      }
      return {
        status: response.data.status,
        newlyClaimed: response.data.newlyClaimed,
      };
    },
    acknowledgeReleased: async (groupId, acceptanceId) => {
      parseOperation(
        await sendBackgroundMessage({
          type: 'ACK_BLOCKED_PROMPT_STAGE_RELEASED',
          groupId,
          acceptanceId,
        }),
      );
    },
    discard: async (groupId, acceptanceId) => {
      parseOperation(
        await sendBackgroundMessage({
          type: 'DISCARD_BLOCKED_PROMPT_STAGE',
          groupId,
          acceptanceId,
        }),
      );
    },
  };
}

export const promptStageClient = createPromptStageClient();
