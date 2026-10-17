import { z } from 'zod/mini';

import {
  BLOCKED_PROMPT_STAGE_TTL_MS,
  BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
  MAX_BLOCKED_PROMPT_STAGES,
  MAX_BLOCKED_STAGE_AGGREGATE_CHARS,
  MAX_BLOCKED_STAGE_SERIALIZED_CHARS,
  blockedPromptStageManifestSchema,
  blockedPromptStageReceiptSchema,
  blockedPromptStageSchema,
  estimateBlockedPromptStageChars,
  validateBlockedPromptStageInput,
  type BlockedPromptStage,
  type BlockedPromptStageInput,
  type BlockedPromptStageManifest,
  type BlockedPromptStageStatus,
} from '../protocol/prompt-stage';

const DATABASE_NAME = 'grok-automator-blocked-stages';
const OBJECT_STORE_NAME = 'prompt-stages';
const DATABASE_VERSION = 1;
const RELEASED_STAGE_TTL_MS = 30 * 60_000;
const MAX_RELEASE_RECEIPTS = 128;

const storageKeySchema = z
  .string()
  .check(z.minLength(1), z.maxLength(300), z.regex(/^[A-Za-z0-9:._~-]+$/u));

const stageEnvelopeSchema = z.strictObject({
  kind: z.literal('stage'),
  storageKey: storageKeySchema,
  tabId: z.number().check(z.int(), z.nonnegative()),
  groupId: z.string().check(z.minLength(1), z.maxLength(128)),
  acceptanceId: z.string().check(z.minLength(16), z.maxLength(128)),
  phase: z.enum(['blocked', 'released', 'claimed']),
  expiresAt: z.number().check(z.int(), z.nonnegative()),
  serializedChars: z
    .number()
    .check(
      z.int(),
      z.minimum(1),
      z.maximum(MAX_BLOCKED_STAGE_SERIALIZED_CHARS),
    ),
  serialized: z
    .string()
    .check(z.minLength(1), z.maxLength(MAX_BLOCKED_STAGE_SERIALIZED_CHARS)),
});

const receiptEnvelopeSchema = z.strictObject({
  kind: z.literal('receipt'),
  storageKey: storageKeySchema,
  receipt: blockedPromptStageReceiptSchema,
});

const storedEnvelopeSchema = z.discriminatedUnion('kind', [
  stageEnvelopeSchema,
  receiptEnvelopeSchema,
]);

type StoredEnvelope = z.infer<typeof storedEnvelopeSchema>;

export interface PromptStageDriver {
  list: () => Promise<unknown[]>;
  put: (storageKey: string, value: unknown) => Promise<void>;
  delete: (storageKey: string) => Promise<void>;
}

export interface PromptStageStore {
  store: (
    tabId: number,
    input: BlockedPromptStageInput,
    now?: number,
  ) => Promise<BlockedPromptStageStatus>;
  status: (
    tabId: number,
    groupId: string,
    acceptanceId: string,
    now?: number,
  ) => Promise<BlockedPromptStageStatus>;
  listManifests: (
    tabId: number,
    now?: number,
  ) => Promise<BlockedPromptStageManifest[]>;
  readChunk: (
    tabId: number,
    groupId: string,
    acceptanceId: string,
    chunkIndex: number,
    now?: number,
  ) => Promise<{ chunk: string; totalChunks: number } | null>;
  markReleased: (
    tabId: number,
    groupId: string,
    acceptanceId: string,
    now?: number,
  ) => Promise<BlockedPromptStageStatus>;
  markClaimed: (
    tabId: number,
    groupId: string,
    acceptanceId: string,
    now?: number,
  ) => Promise<{ status: BlockedPromptStageStatus; newlyClaimed: boolean }>;
  acknowledgeReleased: (
    tabId: number,
    groupId: string,
    acceptanceId: string,
    now?: number,
  ) => Promise<void>;
  discard: (
    tabId: number,
    groupId: string,
    acceptanceId: string,
    now?: number,
  ) => Promise<void>;
  discardTab: (tabId: number, now?: number) => Promise<void>;
  prune: (now?: number) => Promise<void>;
}

function storageKey(tabId: number, groupId: string): string {
  return `stage:${tabId}:${groupId}`;
}

function parseStageEnvelope(
  envelope: Extract<StoredEnvelope, { kind: 'stage' }>,
): BlockedPromptStage {
  if (
    envelope.serialized.length !== envelope.serializedChars ||
    envelope.serializedChars > MAX_BLOCKED_STAGE_SERIALIZED_CHARS
  ) {
    throw new Error('Stored blocked prompt stage length did not match');
  }
  const parsedJson: unknown = JSON.parse(envelope.serialized);
  const stage = blockedPromptStageSchema.parse(parsedJson);
  if (
    stage.tabId !== envelope.tabId ||
    stage.groupId !== envelope.groupId ||
    stage.acceptanceId !== envelope.acceptanceId ||
    stage.phase !== envelope.phase ||
    stage.expiresAt !== envelope.expiresAt ||
    stage.serializedChars !== estimateBlockedPromptStageChars(stageInput(stage))
  ) {
    throw new Error('Stored blocked prompt stage metadata did not match');
  }
  return stage;
}

function stageInput(stage: BlockedPromptStage): BlockedPromptStageInput {
  return {
    schemaVersion: 1,
    groupId: stage.groupId,
    acceptanceId: stage.acceptanceId,
    createdAt: stage.createdAt,
    payloads: stage.payloads,
    preparedImages: stage.preparedImages,
    concurrentPrompts: stage.concurrentPrompts,
    promptDelaySecondsMin: stage.promptDelaySecondsMin,
    promptDelaySecondsMax: stage.promptDelaySecondsMax,
  };
}

function serializeStage(
  stage: BlockedPromptStage,
): Extract<StoredEnvelope, { kind: 'stage' }> {
  const serialized = JSON.stringify(stage);
  if (
    serialized.length < 1 ||
    serialized.length > MAX_BLOCKED_STAGE_SERIALIZED_CHARS
  ) {
    throw new Error(
      'Blocked prompt stage exceeds the serialized storage limit',
    );
  }
  return stageEnvelopeSchema.parse({
    kind: 'stage',
    storageKey: storageKey(stage.tabId, stage.groupId),
    tabId: stage.tabId,
    groupId: stage.groupId,
    acceptanceId: stage.acceptanceId,
    phase: stage.phase,
    expiresAt: stage.expiresAt,
    serializedChars: serialized.length,
    serialized,
  });
}

function sameInput(
  left: BlockedPromptStageInput,
  right: BlockedPromptStageInput,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isFreshEnvelope(envelope: StoredEnvelope, now: number): boolean {
  const expiresAt =
    envelope.kind === 'stage' ? envelope.expiresAt : envelope.receipt.expiresAt;
  return expiresAt >= now && expiresAt <= now + RELEASED_STAGE_TTL_MS + 5_000;
}

export function createPromptStageStore(
  driver: PromptStageDriver,
): PromptStageStore {
  let operationChain: Promise<void> = Promise.resolve();

  function locked<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationChain.then(operation);
    operationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function loadFresh(now: number): Promise<StoredEnvelope[]> {
    const valid: StoredEnvelope[] = [];
    const invalidKeys: string[] = [];
    for (const raw of await driver.list()) {
      const parsed = storedEnvelopeSchema.safeParse(raw);
      if (!parsed.success || !isFreshEnvelope(parsed.data, now)) {
        if (
          typeof raw === 'object' &&
          raw &&
          'storageKey' in raw &&
          typeof raw.storageKey === 'string' &&
          storageKeySchema.safeParse(raw.storageKey).success
        ) {
          invalidKeys.push(raw.storageKey);
        }
        continue;
      }
      try {
        if (parsed.data.kind === 'stage') parseStageEnvelope(parsed.data);
        valid.push(parsed.data);
      } catch {
        invalidKeys.push(parsed.data.storageKey);
      }
    }
    await Promise.all(
      [...new Set(invalidKeys)].map((key) => driver.delete(key)),
    );
    const receipts = valid
      .filter((entry) => entry.kind === 'receipt')
      .sort(
        (left, right) => left.receipt.recordedAt - right.receipt.recordedAt,
      );
    for (const receipt of receipts.slice(0, -MAX_RELEASE_RECEIPTS)) {
      await driver.delete(receipt.storageKey);
      const index = valid.indexOf(receipt);
      if (index >= 0) valid.splice(index, 1);
    }
    return valid;
  }

  async function findExact(
    tabId: number,
    groupId: string,
    acceptanceId: string,
    now: number,
  ): Promise<StoredEnvelope | null> {
    const key = storageKey(tabId, groupId);
    const candidate = (await loadFresh(now)).find(
      (entry) => entry.storageKey === key,
    );
    if (!candidate) return null;
    const storedAcceptanceId =
      candidate.kind === 'stage'
        ? candidate.acceptanceId
        : candidate.receipt.acceptanceId;
    if (storedAcceptanceId !== acceptanceId) {
      throw new Error('Blocked prompt stage acceptance did not match');
    }
    return candidate;
  }

  return {
    store: (tabId, rawInput, now = Date.now()) =>
      locked(async () => {
        const input = validateBlockedPromptStageInput(rawInput);
        const key = storageKey(tabId, input.groupId);
        const entries = await loadFresh(now);
        const existing = entries.find((entry) => entry.storageKey === key);
        if (existing) {
          const existingAcceptanceId =
            existing.kind === 'stage'
              ? existing.acceptanceId
              : existing.receipt.acceptanceId;
          if (existingAcceptanceId !== input.acceptanceId) {
            throw new Error('Blocked prompt stage acceptance did not match');
          }
          if (existing.kind === 'receipt') return existing.receipt.phase;
          const existingStage = parseStageEnvelope(existing);
          if (!sameInput(stageInput(existingStage), input)) {
            throw new Error('Blocked prompt stage payload changed');
          }
          return existingStage.phase;
        }
        const activeStages = entries.filter((entry) => entry.kind === 'stage');
        if (activeStages.length >= MAX_BLOCKED_PROMPT_STAGES) {
          throw new Error('Too many blocked prompt stages');
        }
        const stage = blockedPromptStageSchema.parse({
          ...input,
          tabId,
          phase: 'blocked',
          expiresAt: now + BLOCKED_PROMPT_STAGE_TTL_MS,
          serializedChars: estimateBlockedPromptStageChars(input),
        });
        const envelope = serializeStage(stage);
        const aggregateChars = activeStages.reduce(
          (sum, entry) => sum + entry.serializedChars,
          envelope.serializedChars,
        );
        if (aggregateChars > MAX_BLOCKED_STAGE_AGGREGATE_CHARS) {
          throw new Error('Blocked prompt stages exceed the aggregate limit');
        }
        await driver.put(envelope.storageKey, envelope);
        return 'blocked';
      }),
    status: (tabId, groupId, acceptanceId, now = Date.now()) =>
      locked(async () => {
        const entry = await findExact(tabId, groupId, acceptanceId, now);
        return entry?.kind === 'stage'
          ? entry.phase
          : entry?.kind === 'receipt'
            ? entry.receipt.phase
            : 'missing';
      }),
    listManifests: (tabId, now = Date.now()) =>
      locked(async () => {
        const entries = await loadFresh(now);
        return entries.flatMap((entry) => {
          if (entry.kind === 'receipt') {
            if (entry.receipt.tabId !== tabId) return [];
            return [
              blockedPromptStageManifestSchema.parse({
                groupId: entry.receipt.groupId,
                acceptanceId: entry.receipt.acceptanceId,
                phase: 'claimed',
                serializedChars: 0,
                totalChunks: 0,
              }),
            ];
          }
          if (entry.tabId !== tabId) return [];
          return [
            blockedPromptStageManifestSchema.parse({
              groupId: entry.groupId,
              acceptanceId: entry.acceptanceId,
              phase: entry.phase,
              serializedChars: entry.serializedChars,
              totalChunks: Math.ceil(
                entry.serializedChars / BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
              ),
            }),
          ];
        });
      }),
    readChunk: (tabId, groupId, acceptanceId, chunkIndex, now = Date.now()) =>
      locked(async () => {
        const entry = await findExact(tabId, groupId, acceptanceId, now);
        if (!entry || entry.kind !== 'stage') return null;
        const totalChunks = Math.ceil(
          entry.serializedChars / BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
        );
        if (
          !Number.isSafeInteger(chunkIndex) ||
          chunkIndex < 0 ||
          chunkIndex >= totalChunks
        ) {
          throw new Error('Blocked prompt stage chunk index is invalid');
        }
        return {
          chunk: entry.serialized.slice(
            chunkIndex * BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
            (chunkIndex + 1) * BLOCKED_STAGE_CHUNK_CHAR_LIMIT,
          ),
          totalChunks,
        };
      }),
    markReleased: (tabId, groupId, acceptanceId, now = Date.now()) =>
      locked(async () => {
        const entry = await findExact(tabId, groupId, acceptanceId, now);
        if (!entry) return 'missing';
        if (entry.kind === 'receipt') return entry.receipt.phase;
        if (entry.phase === 'claimed') return 'claimed';
        if (entry.phase === 'released') return 'released';
        const stage = blockedPromptStageSchema.parse({
          ...parseStageEnvelope(entry),
          phase: 'released',
          expiresAt: now + RELEASED_STAGE_TTL_MS,
        });
        const releasedEnvelope = serializeStage(stage);
        await driver.put(releasedEnvelope.storageKey, releasedEnvelope);
        return 'released';
      }),
    markClaimed: (tabId, groupId, acceptanceId, now = Date.now()) =>
      locked(async () => {
        const entry = await findExact(tabId, groupId, acceptanceId, now);
        if (!entry) {
          return { status: 'missing', newlyClaimed: false };
        }
        if (entry.kind === 'receipt') {
          return { status: entry.receipt.phase, newlyClaimed: false };
        }
        if (entry.phase === 'blocked') {
          return { status: 'blocked', newlyClaimed: false };
        }
        if (entry.phase === 'claimed') {
          return { status: 'claimed', newlyClaimed: false };
        }
        const receipt = blockedPromptStageReceiptSchema.parse({
          schemaVersion: 1,
          groupId,
          acceptanceId,
          tabId,
          phase: 'claimed',
          recordedAt: now,
          expiresAt: now + RELEASED_STAGE_TTL_MS,
        });
        await driver.put(
          entry.storageKey,
          receiptEnvelopeSchema.parse({
            kind: 'receipt',
            storageKey: entry.storageKey,
            receipt,
          }),
        );
        return { status: 'claimed', newlyClaimed: true };
      }),
    acknowledgeReleased: (tabId, groupId, acceptanceId, now = Date.now()) =>
      locked(async () => {
        const entry = await findExact(tabId, groupId, acceptanceId, now);
        if (!entry) throw new Error('Released prompt stage was not found');
        if (entry.kind === 'receipt') return;
        if (entry.phase !== 'released' && entry.phase !== 'claimed') {
          throw new Error('Prompt stage is not released');
        }
        // Keep the released payload durable until the content worker reports a
        // terminal outcome. A real content-script reload can then rehydrate it.
      }),
    discard: (tabId, groupId, acceptanceId, now = Date.now()) =>
      locked(async () => {
        const entry = await findExact(tabId, groupId, acceptanceId, now);
        if (entry) await driver.delete(entry.storageKey);
      }),
    discardTab: (tabId, now = Date.now()) =>
      locked(async () => {
        const entries = await loadFresh(now);
        await Promise.all(
          entries.flatMap((entry) => {
            const owningTabId =
              entry.kind === 'stage' ? entry.tabId : entry.receipt.tabId;
            return owningTabId === tabId
              ? [driver.delete(entry.storageKey)]
              : [];
          }),
        );
      }),
    prune: (now = Date.now()) =>
      locked(async () => {
        await loadFresh(now);
      }),
  };
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error('Blocked prompt stage database failed'),
      );
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ??
          new Error('Blocked prompt stage database transaction failed'),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error('Blocked prompt stage database transaction aborted'),
      );
  });
}

export function createIndexedDbPromptStageDriver(
  indexedDb: IDBFactory = indexedDB,
): PromptStageDriver {
  let databasePromise: Promise<IDBDatabase> | null = null;

  function openDatabase(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE_NAME)) {
          request.result.createObjectStore(OBJECT_STORE_NAME, {
            keyPath: 'storageKey',
          });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ?? new Error('Blocked prompt stage database failed'),
        );
      request.onblocked = () =>
        reject(new Error('Blocked prompt stage database upgrade was blocked'));
    });
    return databasePromise;
  }

  return {
    list: async () => {
      const database = await openDatabase();
      const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly');
      const request = transaction.objectStore(OBJECT_STORE_NAME).getAll();
      const result = await waitForRequest(request);
      await waitForTransaction(transaction);
      return result;
    },
    put: async (_storageKey, value) => {
      const database = await openDatabase();
      const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
      transaction.objectStore(OBJECT_STORE_NAME).put(value);
      await waitForTransaction(transaction);
    },
    delete: async (key) => {
      const database = await openDatabase();
      const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
      transaction.objectStore(OBJECT_STORE_NAME).delete(key);
      await waitForTransaction(transaction);
    },
  };
}

export function createProductionPromptStageStore(): PromptStageStore {
  return createPromptStageStore(createIndexedDbPromptStageDriver());
}
