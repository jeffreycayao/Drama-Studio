import { storage } from '#imports';
import { z } from 'zod/mini';

import {
  DEFAULT_SETTINGS,
  migrateSettings,
  normalizeSettings,
} from './settings';
import type { Settings } from './types';

const settingsItem = storage.defineItem<unknown>(
  'local:grok_automation_settings',
  {
    fallback: DEFAULT_SETTINGS,
  },
);
const localeItem = storage.defineItem<unknown>('local:user-locale', {
  fallback: 'en',
});
const legacySessionAccessTokenItem = storage.defineItem<unknown>(
  'session:auth-access-token',
);
const legacyAccessTokenItem = storage.defineItem<unknown>(
  'local:auth-access-token',
);
const legacyAuthEmailItem = storage.defineItem<unknown>('local:auth-email');
const dailyCountItem = storage.defineItem<unknown>('local:daily-prompt-count', {
  fallback: 0,
});
const dailyDateItem = storage.defineItem<unknown>('local:daily-prompt-date', {
  fallback: '',
});
const legacyInFlightRunCommitsItem = storage.defineItem<unknown>(
  'session:grok-run-commit-recovery',
  { fallback: [] },
);
const IN_FLIGHT_RUN_COMMIT_STORAGE_PREFIX = 'grok-run-commit-recovery:';

const localeSchema = z.string().check(z.regex(/^[a-z]{2}(?:-[A-Z]{2})?$/));
const countSchema = z.number().check(z.int(), z.minimum(0));
const boundedRunIdentifierSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u));
const authorizationIdSchema = z
  .string()
  .check(z.minLength(16), z.maxLength(128), z.regex(/^[A-Za-z0-9_-]+$/u));
const recoveryDeadlineSchema = z.iso
  .datetime({ offset: true })
  .check(z.minLength(20), z.maxLength(35));
const inFlightRunCommitBase = {
  acceptanceId: z
    .string()
    .check(z.minLength(16), z.maxLength(128), z.regex(/^[A-Za-z0-9._~-]+$/u)),
  groupId: boundedRunIdentifierSchema,
  tabId: z.number().check(z.int(), z.minimum(0), z.maximum(2_147_483_647)),
  createdAt: z.number().check(z.int(), z.nonnegative()),
};
const inFlightRunCommitSchema = z.discriminatedUnion('lifecycle', [
  z.strictObject({
    ...inFlightRunCommitBase,
    lifecycle: z.literal('reservation'),
    authorizationId: authorizationIdSchema,
    finalizeBy: z.optional(recoveryDeadlineSchema),
  }),
  z.strictObject({
    ...inFlightRunCommitBase,
    lifecycle: z.literal('legacy-immediate'),
    authorizationId: z.optional(authorizationIdSchema),
    units: z.number().check(z.int(), z.minimum(1), z.maximum(1_000)),
  }),
]);
const MAX_IN_FLIGHT_RUN_COMMITS = 16;
export const IN_FLIGHT_RUN_COMMIT_MAX_AGE_MS = 5 * 60_000 + 10_000;
const inFlightRunCommitsSchema = z
  .array(inFlightRunCommitSchema)
  .check(z.maxLength(MAX_IN_FLIGHT_RUN_COMMITS));

export type InFlightRunCommit = z.infer<typeof inFlightRunCommitSchema>;

let runCommitStorageChain: Promise<void> = Promise.resolve();

function isFreshRunCommit(value: InFlightRunCommit, now: number): boolean {
  const withinCreatedAtWindow =
    value.createdAt <= now + 5_000 &&
    now - value.createdAt <= IN_FLIGHT_RUN_COMMIT_MAX_AGE_MS;
  if (!withinCreatedAtWindow || value.lifecycle !== 'reservation') {
    return withinCreatedAtWindow;
  }
  if (!value.finalizeBy) return true;
  const finalizeBy = Date.parse(value.finalizeBy);
  return (
    Number.isFinite(finalizeBy) &&
    finalizeBy >= value.createdAt &&
    finalizeBy - value.createdAt <= IN_FLIGHT_RUN_COMMIT_MAX_AGE_MS &&
    now <= finalizeBy + 5_000
  );
}

async function readValidatedRunCommits(
  now: number,
): Promise<InFlightRunCommit[]> {
  const legacy = inFlightRunCommitsSchema.safeParse(
    await legacyInFlightRunCommitsItem.getValue(),
  );
  if (legacy.success) {
    await Promise.all(
      legacy.data
        .filter((entry) => isFreshRunCommit(entry, now))
        .map((entry) => storage.setItem(runCommitStorageKey(entry), entry)),
    );
  }
  await legacyInFlightRunCommitsItem.removeValue();

  const snapshot = await storage.snapshot('session');
  const valid: Array<{
    storageKey: `session:${string}`;
    value: InFlightRunCommit;
  }> = [];
  const removeKeys: Array<`session:${string}`> = [];
  for (const [rawKey, rawValue] of Object.entries(snapshot)) {
    if (!rawKey.startsWith(IN_FLIGHT_RUN_COMMIT_STORAGE_PREFIX)) continue;
    const storageKey = `session:${rawKey}` as const;
    const parsed = inFlightRunCommitSchema.safeParse(rawValue);
    if (!parsed.success || !isFreshRunCommit(parsed.data, now)) {
      removeKeys.push(storageKey);
      continue;
    }
    valid.push({ storageKey, value: parsed.data });
  }
  valid.sort((left, right) => left.value.createdAt - right.value.createdAt);
  const retained = valid.slice(-MAX_IN_FLIGHT_RUN_COMMITS);
  removeKeys.push(
    ...valid
      .slice(0, -MAX_IN_FLIGHT_RUN_COMMITS)
      .map((entry) => entry.storageKey),
  );
  if (removeKeys.length > 0) {
    await storage.removeItems([...new Set(removeKeys)]);
  }
  return retained.map((entry) => entry.value);
}

function runCommitStorageKey(value: InFlightRunCommit): `session:${string}` {
  return `session:${IN_FLIGHT_RUN_COMMIT_STORAGE_PREFIX}${value.lifecycle}:${value.acceptanceId}:${value.groupId}:${value.tabId}`;
}

function sameRunCommit(
  left: InFlightRunCommit,
  right: InFlightRunCommit,
): boolean {
  if (
    left.lifecycle !== right.lifecycle ||
    left.acceptanceId !== right.acceptanceId ||
    left.groupId !== right.groupId ||
    left.tabId !== right.tabId ||
    left.createdAt !== right.createdAt
  ) {
    return false;
  }
  if (left.lifecycle === 'reservation' && right.lifecycle === 'reservation') {
    return (
      left.authorizationId === right.authorizationId &&
      left.finalizeBy === right.finalizeBy
    );
  }
  if (
    left.lifecycle === 'legacy-immediate' &&
    right.lifecycle === 'legacy-immediate'
  ) {
    return (
      left.authorizationId === right.authorizationId &&
      left.units === right.units
    );
  }
  return false;
}

function enqueueRunCommitStorageOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = runCommitStorageChain.then(operation);
  runCommitStorageChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function loadInFlightRunCommits(
  now = Date.now(),
): Promise<InFlightRunCommit[]> {
  return enqueueRunCommitStorageOperation(async () => {
    const entries = await readValidatedRunCommits(now);
    return entries.map((entry) => ({ ...entry }));
  });
}

export async function saveInFlightRunCommit(
  value: InFlightRunCommit,
  now = Date.now(),
): Promise<void> {
  const parsed = inFlightRunCommitSchema.parse(value);
  if (!isFreshRunCommit(parsed, now)) {
    throw new Error('Run commit recovery metadata is expired');
  }
  await enqueueRunCommitStorageOperation(async () => {
    await storage.setItem(runCommitStorageKey(parsed), parsed);
    await readValidatedRunCommits(now);
  });
}

export async function clearInFlightRunCommit(
  expected: InFlightRunCommit,
  now = Date.now(),
): Promise<void> {
  const parsed = inFlightRunCommitSchema.parse(expected);
  await enqueueRunCommitStorageOperation(async () => {
    await readValidatedRunCommits(now);
    const key = runCommitStorageKey(parsed);
    const current = inFlightRunCommitSchema.safeParse(
      await storage.getItem<unknown>(key),
    );
    if (current.success && sameRunCommit(current.data, parsed)) {
      await storage.removeItem(key);
    }
  });
}

export async function loadSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  const migrated = migrateSettings(stored);
  await settingsItem.setValue(migrated);
  return migrated;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsItem.setValue(normalizeSettings(settings));
}

export function watchSettings(
  onChange: (settings: Settings) => void,
  onError: (error: unknown) => void,
): () => void {
  return settingsItem.watch((value) => {
    try {
      onChange(migrateSettings(value));
    } catch (error) {
      onError(error);
    }
  });
}

export async function resetSettings(): Promise<Settings> {
  const reset = { ...DEFAULT_SETTINGS };
  await settingsItem.setValue(reset);
  return reset;
}

export async function loadLocale(): Promise<string> {
  const result = localeSchema.safeParse(await localeItem.getValue());
  return result.success ? result.data : 'en';
}

export async function saveLocale(locale: string): Promise<void> {
  const result = localeSchema.safeParse(locale);
  if (!result.success) throw new Error('Invalid locale');
  await localeItem.setValue(result.data);
}

export async function purgeLegacyAuthStorage(): Promise<void> {
  await Promise.all([
    legacySessionAccessTokenItem.removeValue(),
    legacyAccessTokenItem.removeValue(),
    legacyAuthEmailItem.removeValue(),
  ]);
}

export function utcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function loadDailyPromptCount(date = new Date()): Promise<number> {
  const today = utcDateKey(date);
  const [rawCount, rawDate] = await Promise.all([
    dailyCountItem.getValue(),
    dailyDateItem.getValue(),
  ]);
  const count = countSchema.safeParse(rawCount);
  return rawDate === today && count.success ? count.data : 0;
}

export async function incrementDailyPromptCount(
  amount: number,
  date = new Date(),
): Promise<number> {
  const parsedAmount = countSchema.parse(amount);
  const today = utcDateKey(date);
  const next = (await loadDailyPromptCount(date)) + parsedAmount;
  await Promise.all([
    dailyCountItem.setValue(next),
    dailyDateItem.setValue(today),
  ]);
  return next;
}
