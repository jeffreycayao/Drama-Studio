import { describe, expect, it } from 'vitest';

import {
  createPromptStageStore,
  type PromptStageDriver,
} from '../../src/background/prompt-stage-store';
import {
  BLOCKED_PROMPT_STAGE_TTL_MS,
  BLOCKED_STAGE_TRANSFER_TIMEOUT_MS,
  blockedPromptStageSchema,
  type BlockedPromptStageInput,
} from '../../src/protocol/prompt-stage';

function stageInput(): BlockedPromptStageInput {
  return {
    schemaVersion: 1,
    groupId: 'group-durable-reload',
    acceptanceId: 'run.durable_reload_1234567890',
    createdAt: 1_000,
    payloads: [
      {
        prompt: 'Persist this exact prompt across a content reload',
        promptIndex: 1,
        mode: 'textToImage',
        aspectRatio: '16:9',
        outputCount: 1,
        folderName: 'results',
        autoDownloadResourceQuality: '1k',
      },
    ],
    preparedImages: {},
    concurrentPrompts: 1,
    promptDelaySecondsMin: 0,
    promptDelaySecondsMax: 0,
  };
}

function memoryDriver(): PromptStageDriver {
  const entries = new Map<string, unknown>();
  return {
    list: async () => [...entries.values()],
    put: async (key, value) => {
      entries.set(key, structuredClone(value));
    },
    delete: async (key) => {
      entries.delete(key);
    },
  };
}

async function readStage(
  store: ReturnType<typeof createPromptStageStore>,
  tabId: number,
  input: BlockedPromptStageInput,
  now: number,
) {
  const manifest = (await store.listManifests(tabId, now))[0];
  if (!manifest) throw new Error('Expected prompt stage manifest');
  const chunks: string[] = [];
  for (let index = 0; index < manifest.totalChunks; index += 1) {
    const result = await store.readChunk(
      tabId,
      input.groupId,
      input.acceptanceId,
      index,
      now,
    );
    if (!result) throw new Error('Expected prompt stage chunk');
    chunks.push(result.chunk);
  }
  return blockedPromptStageSchema.parse(JSON.parse(chunks.join('')));
}

describe('durable blocked prompt stage store', () => {
  it('survives store reinitialization and remains inert until exact release', async () => {
    const driver = memoryDriver();
    const input = stageInput();
    const tabId = 42;
    const now = 10_000;
    const firstStore = createPromptStageStore(driver);

    await expect(firstStore.store(tabId, input, now)).resolves.toBe('blocked');
    const restartedStore = createPromptStageStore(driver);
    await expect(
      restartedStore.status(tabId, input.groupId, input.acceptanceId, now + 1),
    ).resolves.toBe('blocked');
    await expect(
      readStage(restartedStore, tabId, input, now + 1),
    ).resolves.toMatchObject({
      phase: 'blocked',
      payloads: [{ prompt: input.payloads[0]?.prompt }],
    });
  });

  it('extends released lifetime past the original expiry and retains payload through acknowledgement', async () => {
    const driver = memoryDriver();
    const input = stageInput();
    const tabId = 84;
    const now = 20_000;
    const originalExpiry = now + BLOCKED_PROMPT_STAGE_TTL_MS;
    const store = createPromptStageStore(driver);
    await store.store(tabId, input, now);

    await expect(
      store.markReleased(
        tabId,
        input.groupId,
        input.acceptanceId,
        originalExpiry - 1,
      ),
    ).resolves.toBe('released');
    await store.acknowledgeReleased(
      tabId,
      input.groupId,
      input.acceptanceId,
      originalExpiry,
    );

    const afterOriginalExpiry =
      originalExpiry + BLOCKED_STAGE_TRANSFER_TIMEOUT_MS + 1;
    const restartedStore = createPromptStageStore(driver);
    await expect(
      readStage(restartedStore, tabId, input, afterOriginalExpiry),
    ).resolves.toMatchObject({
      phase: 'released',
      payloads: [{ prompt: input.payloads[0]?.prompt }],
    });
    await expect(
      restartedStore.markClaimed(
        tabId,
        input.groupId,
        input.acceptanceId,
        afterOriginalExpiry,
      ),
    ).resolves.toEqual({ status: 'claimed', newlyClaimed: true });
    await expect(
      restartedStore.markClaimed(
        tabId,
        input.groupId,
        input.acceptanceId,
        afterOriginalExpiry + 1,
      ),
    ).resolves.toEqual({ status: 'claimed', newlyClaimed: false });

    await restartedStore.discard(
      tabId,
      input.groupId,
      input.acceptanceId,
      afterOriginalExpiry,
    );
    await expect(
      restartedStore.status(
        tabId,
        input.groupId,
        input.acceptanceId,
        afterOriginalExpiry,
      ),
    ).resolves.toBe('missing');
  });
});
