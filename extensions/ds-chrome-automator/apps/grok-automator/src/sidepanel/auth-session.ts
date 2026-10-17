import { storage } from '#imports';
import {
  accessTokenSchema,
  isoDateTimeSchema,
  parseAuthorizedExtensionAuthFlowResponse,
  sessionSchema,
} from './auth-contract';
import { z } from 'zod/mini';

export const GROK_AUTOMATOR_APP_ID = 'grok-automator';
export const APP_SESSION_STORAGE_KEY = 'session:faceless-app-session';

const MAX_APP_SESSION_SECONDS = 3_600;
const MAX_CLOCK_SKEW_MS = 60_000;

export const storedAppSessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  appAccessToken: accessTokenSchema,
  tokenType: z.literal('Bearer'),
  expiresAt: isoDateTimeSchema,
  session: sessionSchema,
});

export type StoredAppSession = z.infer<typeof storedAppSessionSchema>;

const appSessionItem = storage.defineItem<unknown>(APP_SESSION_STORAGE_KEY);
let sessionMutationChain: Promise<void> = Promise.resolve();

function serializeSessionMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionMutationChain.then(operation, operation);
  sessionMutationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function serializedStorageValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function isValidSessionWindow(
  value: StoredAppSession,
  nowMilliseconds: number,
): boolean {
  const issuedAt = Date.parse(value.session.issuedAt);
  const sessionExpiresAt = Date.parse(value.session.expiresAt);
  const credentialExpiresAt = Date.parse(value.expiresAt);
  const maximumLifetimeMilliseconds = MAX_APP_SESSION_SECONDS * 1_000;

  return (
    value.session.account.provider === 'google' &&
    value.session.account.emailVerified === true &&
    value.session.access.appId === GROK_AUTOMATOR_APP_ID &&
    issuedAt <= nowMilliseconds + MAX_CLOCK_SKEW_MS &&
    sessionExpiresAt > nowMilliseconds &&
    credentialExpiresAt > nowMilliseconds &&
    credentialExpiresAt <= sessionExpiresAt &&
    credentialExpiresAt - nowMilliseconds <= maximumLifetimeMilliseconds &&
    sessionExpiresAt - issuedAt <= maximumLifetimeMilliseconds
  );
}

export function parseStoredAppSession(
  value: unknown,
  nowMilliseconds = Date.now(),
): StoredAppSession | null {
  const parsed = storedAppSessionSchema.safeParse(value);
  if (!parsed.success || !isValidSessionWindow(parsed.data, nowMilliseconds)) {
    return null;
  }
  return parsed.data;
}

export function createStoredAppSession(
  value: unknown,
  nowMilliseconds = Date.now(),
): StoredAppSession {
  const response = parseAuthorizedExtensionAuthFlowResponse(value);
  const sessionExpiresAt = Date.parse(response.session.expiresAt);
  const credentialExpiresAt = Math.min(
    sessionExpiresAt,
    nowMilliseconds + response.expiresInSeconds * 1_000,
  );
  const candidate: StoredAppSession = {
    schemaVersion: 1,
    appAccessToken: response.accessToken,
    tokenType: response.tokenType,
    expiresAt: new Date(credentialExpiresAt).toISOString(),
    session: response.session,
  };
  const parsed = parseStoredAppSession(candidate, nowMilliseconds);
  if (!parsed) {
    throw new Error('The platform returned an invalid or expired app session.');
  }
  return parsed;
}

export async function saveAppSession(
  value: StoredAppSession,
  nowMilliseconds = Date.now(),
): Promise<void> {
  const parsed = parseStoredAppSession(value, nowMilliseconds);
  if (!parsed) throw new Error('Refusing to store an invalid app session.');
  await serializeSessionMutation(() => appSessionItem.setValue(parsed));
}

export async function loadAppSession(
  nowMilliseconds = Date.now(),
): Promise<StoredAppSession | null> {
  const stored = await appSessionItem.getValue();
  const parsed = parseStoredAppSession(stored, nowMilliseconds);
  if (!parsed && stored !== null && stored !== undefined) {
    const expected = serializedStorageValue(stored);
    await serializeSessionMutation(async () => {
      const current = await appSessionItem.getValue();
      if (serializedStorageValue(current) === expected) {
        await appSessionItem.removeValue();
      }
    });
  }
  return parsed;
}

export async function clearAppSession(): Promise<void> {
  await serializeSessionMutation(() => appSessionItem.removeValue());
}

function isSameStoredSession(
  candidate: StoredAppSession,
  expected: StoredAppSession,
): boolean {
  return (
    candidate.appAccessToken === expected.appAccessToken &&
    candidate.expiresAt === expected.expiresAt &&
    candidate.session.sessionId === expected.session.sessionId
  );
}

export async function clearAppSessionIfMatching(
  expected: StoredAppSession,
): Promise<boolean> {
  return serializeSessionMutation(async () => {
    const current = storedAppSessionSchema.safeParse(
      await appSessionItem.getValue(),
    );
    if (!current.success || !isSameStoredSession(current.data, expected)) {
      return false;
    }
    await appSessionItem.removeValue();
    return true;
  });
}
