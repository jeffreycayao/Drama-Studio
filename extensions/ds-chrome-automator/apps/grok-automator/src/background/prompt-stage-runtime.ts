import type { BackgroundMessage } from '../protocol/background';
import {
  BLOCKED_STAGE_TRANSFER_TIMEOUT_MS,
  MAX_BLOCKED_STAGE_AGGREGATE_CHARS,
  MAX_BLOCKED_STAGE_SERIALIZED_CHARS,
  MAX_CONCURRENT_BLOCKED_STAGE_TRANSFERS,
  validateBlockedPromptStageInput,
} from '../protocol/prompt-stage';
import type { PromptStageStore } from './prompt-stage-store';

interface StageTransferBuffer {
  tabId: number;
  groupId: string;
  acceptanceId: string;
  chunks: Array<string | undefined>;
  totalChunks: number;
  receivedCount: number;
  totalChars: number;
  updatedAt: number;
}

type PromptStageBackgroundMessage = Extract<
  BackgroundMessage,
  {
    type:
      | 'STORE_BLOCKED_PROMPT_STAGE_CHUNK'
      | 'LIST_BLOCKED_PROMPT_STAGES'
      | 'READ_BLOCKED_PROMPT_STAGE_CHUNK'
      | 'GET_BLOCKED_PROMPT_STAGE_STATUS'
      | 'MARK_BLOCKED_PROMPT_STAGE_RELEASED'
      | 'MARK_BLOCKED_PROMPT_STAGE_CLAIMED'
      | 'ACK_BLOCKED_PROMPT_STAGE_RELEASED'
      | 'DISCARD_BLOCKED_PROMPT_STAGE';
  }
>;

export interface PromptStageRuntime {
  handle: (
    message: PromptStageBackgroundMessage,
    tabId: number,
  ) => Promise<Record<string, unknown>>;
  discardTab: (tabId: number) => Promise<void>;
  prune: () => Promise<void>;
}

export function createPromptStageRuntime(
  store: PromptStageStore,
  now: () => number = Date.now,
): PromptStageRuntime {
  const transfers = new Map<string, StageTransferBuffer>();

  function transferKey(
    tabId: number,
    groupId: string,
    acceptanceId: string,
  ): string {
    return `${tabId}:${groupId}:${acceptanceId}`;
  }

  function pruneTransfers(currentTime = now()): void {
    for (const [key, transfer] of transfers) {
      if (
        currentTime - transfer.updatedAt >=
        BLOCKED_STAGE_TRANSFER_TIMEOUT_MS
      ) {
        transfers.delete(key);
      }
    }
  }

  async function storeChunk(
    message: Extract<
      PromptStageBackgroundMessage,
      { type: 'STORE_BLOCKED_PROMPT_STAGE_CHUNK' }
    >,
    tabId: number,
  ): Promise<Record<string, unknown>> {
    const currentTime = now();
    pruneTransfers(currentTime);
    const existingStatus = await store.status(
      tabId,
      message.groupId,
      message.acceptanceId,
      currentTime,
    );
    if (existingStatus !== 'missing') {
      return {
        success: true,
        stored: true,
        status: existingStatus,
        acceptanceId: message.acceptanceId,
      };
    }

    const key = transferKey(tabId, message.groupId, message.acceptanceId);
    const existing = transfers.get(key);
    if (existing && existing.totalChunks !== message.totalChunks) {
      transfers.delete(key);
      throw new Error('Blocked prompt stage chunk count changed');
    }
    if (!existing && transfers.size >= MAX_CONCURRENT_BLOCKED_STAGE_TRANSFERS) {
      throw new Error('Too many blocked prompt stage transfers');
    }
    const transfer =
      existing ??
      ({
        tabId,
        groupId: message.groupId,
        acceptanceId: message.acceptanceId,
        chunks: Array<string | undefined>(message.totalChunks),
        totalChunks: message.totalChunks,
        receivedCount: 0,
        totalChars: 0,
        updatedAt: currentTime,
      } satisfies StageTransferBuffer);
    transfers.set(key, transfer);
    const priorChunk = transfer.chunks[message.chunkIndex];
    if (priorChunk !== undefined && priorChunk !== message.chunk) {
      transfers.delete(key);
      throw new Error('Blocked prompt stage chunk changed');
    }
    if (priorChunk === undefined) {
      transfer.chunks[message.chunkIndex] = message.chunk;
      transfer.receivedCount += 1;
      transfer.totalChars += message.chunk.length;
    }
    transfer.updatedAt = currentTime;
    const activeChars = [...transfers.values()].reduce(
      (sum, candidate) => sum + candidate.totalChars,
      0,
    );
    if (
      transfer.totalChars > MAX_BLOCKED_STAGE_SERIALIZED_CHARS ||
      activeChars > MAX_BLOCKED_STAGE_AGGREGATE_CHARS
    ) {
      transfers.delete(key);
      throw new Error('Blocked prompt stage transfer exceeded its size limit');
    }
    if (transfer.receivedCount !== transfer.totalChunks) {
      return {
        success: true,
        stored: false,
        receivedCount: transfer.receivedCount,
        totalChunks: transfer.totalChunks,
      };
    }

    try {
      const serialized = transfer.chunks.map((chunk) => chunk ?? '').join('');
      const rawInput: unknown = JSON.parse(serialized);
      const input = validateBlockedPromptStageInput(rawInput);
      if (
        input.groupId !== message.groupId ||
        input.acceptanceId !== message.acceptanceId
      ) {
        throw new Error('Blocked prompt stage transfer identity did not match');
      }
      const status = await store.store(tabId, input, currentTime);
      return {
        success: true,
        stored: true,
        status,
        acceptanceId: input.acceptanceId,
      };
    } finally {
      transfers.delete(key);
    }
  }

  return {
    handle: async (message, tabId) => {
      switch (message.type) {
        case 'STORE_BLOCKED_PROMPT_STAGE_CHUNK':
          return storeChunk(message, tabId);
        case 'LIST_BLOCKED_PROMPT_STAGES':
          return {
            success: true,
            stages: await store.listManifests(tabId, now()),
          };
        case 'READ_BLOCKED_PROMPT_STAGE_CHUNK': {
          const result = await store.readChunk(
            tabId,
            message.groupId,
            message.acceptanceId,
            message.chunkIndex,
            now(),
          );
          return result
            ? { success: true, ...result }
            : { success: false, error: 'Blocked prompt stage was not found' };
        }
        case 'GET_BLOCKED_PROMPT_STAGE_STATUS':
          return {
            success: true,
            status: await store.status(
              tabId,
              message.groupId,
              message.acceptanceId,
              now(),
            ),
            acceptanceId: message.acceptanceId,
          };
        case 'MARK_BLOCKED_PROMPT_STAGE_RELEASED':
          return {
            success: true,
            status: await store.markReleased(
              tabId,
              message.groupId,
              message.acceptanceId,
              now(),
            ),
            acceptanceId: message.acceptanceId,
          };
        case 'MARK_BLOCKED_PROMPT_STAGE_CLAIMED': {
          const result = await store.markClaimed(
            tabId,
            message.groupId,
            message.acceptanceId,
            now(),
          );
          return {
            success: true,
            ...result,
            acceptanceId: message.acceptanceId,
          };
        }
        case 'ACK_BLOCKED_PROMPT_STAGE_RELEASED':
          await store.acknowledgeReleased(
            tabId,
            message.groupId,
            message.acceptanceId,
            now(),
          );
          return { success: true, acceptanceId: message.acceptanceId };
        case 'DISCARD_BLOCKED_PROMPT_STAGE':
          await store.discard(
            tabId,
            message.groupId,
            message.acceptanceId,
            now(),
          );
          transfers.delete(
            transferKey(tabId, message.groupId, message.acceptanceId),
          );
          return { success: true, acceptanceId: message.acceptanceId };
      }
    },
    discardTab: async (tabId) => {
      for (const [key, transfer] of transfers) {
        if (transfer.tabId === tabId) transfers.delete(key);
      }
      await store.discardTab(tabId, now());
    },
    prune: () => store.prune(now()),
  };
}
