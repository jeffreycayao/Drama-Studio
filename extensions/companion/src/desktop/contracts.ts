import { z } from 'zod/mini';

/**
 * Wire format between the Companion and the Drama Studio native host
 * (plan §4). The desktop side must validate the same shapes; keep the two
 * in step and bump PROTOCOL_VERSION on any breaking change.
 */
export const NATIVE_HOST_NAME = 'com.dramastudio.companion';
export const PROTOCOL_VERSION = 1;

/** Why the desktop link could not answer. Shown to the person in plain words. */
export const desktopErrorCodeSchema = z.enum([
  'permission-missing',
  'host-missing',
  'app-not-running',
  'not-paired',
  'handoff-expired',
  'handoff-wrong-site',
  'timeout',
  'protocol',
]);
export type DesktopErrorCode = z.infer<typeof desktopErrorCodeSchema>;

const requestIdSchema = z.string().check(z.minLength(8), z.maxLength(64));
const handoffTokenSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]{16,128}$/));

// Companion -> desktop
export const helloRequestSchema = z.strictObject({
  type: z.literal('hello'),
  id: requestIdSchema,
  protocol: z.literal(PROTOCOL_VERSION),
  extVersion: z.string().check(z.maxLength(32)),
  browser: z.string().check(z.maxLength(64)),
});

export const handoffFetchRequestSchema = z.strictObject({
  type: z.literal('handoff.fetch'),
  id: requestIdSchema,
  protocol: z.literal(PROTOCOL_VERSION),
  token: handoffTokenSchema,
});

export const batchProgressSchema = z.strictObject({
  type: z.literal('batch.progress'),
  id: requestIdSchema,
  protocol: z.literal(PROTOCOL_VERSION),
  batchId: z.string().check(z.minLength(1), z.maxLength(128)),
  done: z.int().check(z.nonnegative()),
  total: z.int().check(z.nonnegative()),
});

export const batchStoppedSchema = z.strictObject({
  type: z.literal('batch.stopped'),
  id: requestIdSchema,
  protocol: z.literal(PROTOCOL_VERSION),
  batchId: z.string().check(z.minLength(1), z.maxLength(128)),
  reason: z.enum([
    'finished',
    'cancelled',
    'captcha',
    'usage-limit',
    'moderation',
    'sign-in',
    'site-changed',
  ]),
});

export const companionRequestSchema = z.discriminatedUnion('type', [
  helloRequestSchema,
  handoffFetchRequestSchema,
  batchProgressSchema,
  batchStoppedSchema,
]);
export type CompanionRequest = z.infer<typeof companionRequestSchema>;

// Desktop -> Companion
const promptTextSchema = z.string().check(z.minLength(1), z.maxLength(200_000));

export const helloReplySchema = z.strictObject({
  type: z.literal('hello.reply'),
  id: requestIdSchema,
  appVersion: z.string().check(z.maxLength(32)),
  paired: z.boolean(),
});

export const handoffReplySchema = z.strictObject({
  type: z.literal('handoff.reply'),
  id: requestIdSchema,
  prompt: promptTextSchema,
  /** Prompt-site id the hand-off was created for, e.g. "chatgpt". */
  site: z.string().check(z.minLength(1), z.maxLength(32)),
});

export const errorReplySchema = z.strictObject({
  type: z.literal('error'),
  id: requestIdSchema,
  code: desktopErrorCodeSchema,
});

export const desktopReplySchema = z.discriminatedUnion('type', [
  helloReplySchema,
  handoffReplySchema,
  errorReplySchema,
]);
export type DesktopReply = z.infer<typeof desktopReplySchema>;

export type DesktopResult<T> =
  { ok: true; value: T } | { ok: false; code: DesktopErrorCode };

export const DESKTOP_ERROR_MESSAGES: Record<DesktopErrorCode, string> = {
  'permission-missing':
    'Connect the Companion to Drama Studio first (Settings › Drama Studio desktop).',
  'host-missing':
    'This copy of Drama Studio does not include the browser link yet. Update Drama Studio, then try again.',
  'app-not-running': 'Open Drama Studio, then try again.',
  'not-paired':
    'Allow this browser in Drama Studio (Settings › Browser), then try again.',
  'handoff-expired':
    'This hand-off has expired or was already used. Send the prompt from Drama Studio again.',
  'handoff-wrong-site':
    'This hand-off was meant for a different site, so it was not filled.',
  timeout: 'Drama Studio did not answer in time. Try again.',
  protocol:
    'Drama Studio sent an answer the Companion does not understand. Update both, then try again.',
};
