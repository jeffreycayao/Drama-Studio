import { z } from 'zod/mini';

/**
 * Wire format between the Companion and the Drama Studio native host
 * (plan §4, docs/PLAN_AI_BROWSER_WORKSPACE.md). The desktop side
 * (electron/companionLink/protocol.cjs) validates the same shapes; both
 * sides test the shared examples in tests/fixtures/desktop-link-v2.json.
 *
 * Protocol 2 added browser jobs and captures. `hello` and `handoff.fetch`
 * still go out as protocol 1, so this Companion keeps working with a
 * Drama Studio that only knows protocol 1; the newer desktop accepts both.
 */
export const NATIVE_HOST_NAME = 'com.dramastudio.companion';
export const PROTOCOL_VERSION = 2;
export const LEGACY_PROTOCOL_VERSION = 1;
export const LEGACY_REQUEST_TYPES: readonly string[] = [
  'hello',
  'handoff.fetch',
];

/** Raw bytes per reference read (desktop -> Companion stays under 1 MB). */
export const ASSET_CHUNK_BYTES = 512 * 1024;
/** Raw bytes per capture chunk (Companion -> desktop). */
export const CAPTURE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_CAPTURE_BYTES = 1024 * 1024 * 1024;
export const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;
export const MAX_CAPTURE_PROMPT_CHARS = 20_000;

export const CAPTURE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;
export const JOB_STATES = [
  'filling',
  'waiting-user',
  'generating',
  'stopped',
  'failed',
  'done',
] as const;
export const JOB_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;

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
  'job-expired',
  'job-not-found',
  'capture-refused',
  'capture-corrupt',
  'too-large',
]);
export type DesktopErrorCode = z.infer<typeof desktopErrorCodeSchema>;

const requestIdSchema = z.string().check(z.minLength(8), z.maxLength(64));
const handoffTokenSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]{16,128}$/));
const objectIdSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/));
const nonNegativeIntSchema = z.int().check(z.nonnegative());
const sha256Schema = z.string().check(z.regex(/^[a-f0-9]{64}$/));
const captureMimeSchema = z.enum(CAPTURE_MIME_TYPES);
const jobStateSchema = z.enum(JOB_STATES);
const legacyProtocol = z.union([
  z.literal(LEGACY_PROTOCOL_VERSION),
  z.literal(PROTOCOL_VERSION),
]);
const v2Protocol = z.literal(PROTOCOL_VERSION);

/** Padded base64 for at most `rawBytes` bytes. */
const base64Schema = (rawBytes: number, minLength: number) =>
  z
    .string()
    .check(
      z.minLength(minLength),
      z.maxLength(Math.ceil(rawBytes / 3) * 4),
      z.regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
    );

// Companion -> desktop
export const helloRequestSchema = z.strictObject({
  type: z.literal('hello'),
  id: requestIdSchema,
  protocol: legacyProtocol,
  extVersion: z.string().check(z.maxLength(32)),
  browser: z.string().check(z.maxLength(64)),
});

export const handoffFetchRequestSchema = z.strictObject({
  type: z.literal('handoff.fetch'),
  id: requestIdSchema,
  protocol: legacyProtocol,
  token: handoffTokenSchema,
});

export const jobFetchRequestSchema = z.strictObject({
  type: z.literal('job.fetch'),
  id: requestIdSchema,
  protocol: v2Protocol,
  token: handoffTokenSchema,
});

export const assetReadRequestSchema = z.strictObject({
  type: z.literal('asset.read'),
  id: requestIdSchema,
  protocol: v2Protocol,
  jobId: objectIdSchema,
  refId: objectIdSchema,
  offset: nonNegativeIntSchema,
});

export const jobUpdateRequestSchema = z.strictObject({
  type: z.literal('job.update'),
  id: requestIdSchema,
  protocol: v2Protocol,
  jobId: objectIdSchema,
  state: jobStateSchema,
  reason: z.optional(z.string().check(z.maxLength(200))),
});

export const captureBeginRequestSchema = z.strictObject({
  type: z.literal('capture.begin'),
  id: requestIdSchema,
  protocol: v2Protocol,
  jobId: z.nullable(objectIdSchema),
  site: z.string().check(z.minLength(1), z.maxLength(32)),
  prompt: z.nullable(z.string().check(z.maxLength(MAX_CAPTURE_PROMPT_CHARS))),
  mime: captureMimeSchema,
  bytes: z.int().check(z.minimum(1), z.maximum(MAX_CAPTURE_BYTES)),
  sha256: sha256Schema,
  name: z.string().check(z.maxLength(200)),
});

export const captureChunkRequestSchema = z.strictObject({
  type: z.literal('capture.chunk'),
  id: requestIdSchema,
  protocol: v2Protocol,
  captureId: objectIdSchema,
  index: nonNegativeIntSchema,
  data: base64Schema(CAPTURE_CHUNK_BYTES, 4),
});

export const captureEndRequestSchema = z.strictObject({
  type: z.literal('capture.end'),
  id: requestIdSchema,
  protocol: v2Protocol,
  captureId: objectIdSchema,
});

export const batchProgressSchema = z.strictObject({
  type: z.literal('batch.progress'),
  id: requestIdSchema,
  protocol: v2Protocol,
  batchId: z.string().check(z.minLength(1), z.maxLength(128)),
  done: nonNegativeIntSchema,
  total: nonNegativeIntSchema,
});

export const batchStoppedSchema = z.strictObject({
  type: z.literal('batch.stopped'),
  id: requestIdSchema,
  protocol: v2Protocol,
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
  jobFetchRequestSchema,
  assetReadRequestSchema,
  jobUpdateRequestSchema,
  captureBeginRequestSchema,
  captureChunkRequestSchema,
  captureEndRequestSchema,
  batchProgressSchema,
  batchStoppedSchema,
]);
export type CompanionRequest = z.infer<typeof companionRequestSchema>;
export type CompanionRequestType = CompanionRequest['type'];
export type JobState = z.infer<typeof jobStateSchema>;
export type CaptureMime = z.infer<typeof captureMimeSchema>;

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

export const jobReferenceSchema = z.strictObject({
  refId: objectIdSchema,
  name: z.string().check(z.maxLength(200)),
  mime: captureMimeSchema,
  bytes: z.int().check(z.minimum(1), z.maximum(MAX_REFERENCE_BYTES)),
});
export type JobReference = z.infer<typeof jobReferenceSchema>;

export const jobParamsSchema = z.strictObject({
  aspect: z.optional(z.enum(JOB_ASPECTS)),
  durationSeconds: z.optional(z.int().check(z.minimum(1), z.maximum(60))),
});
export type JobParams = z.infer<typeof jobParamsSchema>;

export const jobReplySchema = z.strictObject({
  type: z.literal('job.reply'),
  id: requestIdSchema,
  jobId: objectIdSchema,
  /** Job-site id, e.g. "grok-imagine". */
  site: z.string().check(z.minLength(1), z.maxLength(32)),
  kind: z.enum(['image', 'video']),
  prompt: promptTextSchema,
  params: jobParamsSchema,
  references: z.array(jobReferenceSchema).check(z.maxLength(8)),
});

export const assetChunkReplySchema = z.strictObject({
  type: z.literal('asset.chunk'),
  id: requestIdSchema,
  jobId: objectIdSchema,
  refId: objectIdSchema,
  offset: nonNegativeIntSchema,
  data: base64Schema(ASSET_CHUNK_BYTES, 0),
  done: z.boolean(),
  bytes: z.int().check(z.minimum(1), z.maximum(MAX_REFERENCE_BYTES)),
});

export const ackReplySchema = z.strictObject({
  type: z.literal('ack'),
  id: requestIdSchema,
});

export const captureReadyReplySchema = z.strictObject({
  type: z.literal('capture.ready'),
  id: requestIdSchema,
  captureId: objectIdSchema,
  chunkBytes: z
    .int()
    .check(z.minimum(64 * 1024), z.maximum(CAPTURE_CHUNK_BYTES)),
});

export const captureDoneReplySchema = z.strictObject({
  type: z.literal('capture.done'),
  id: requestIdSchema,
  captureId: objectIdSchema,
});

export const errorReplySchema = z.strictObject({
  type: z.literal('error'),
  id: requestIdSchema,
  code: desktopErrorCodeSchema,
});

export const desktopReplySchema = z.discriminatedUnion('type', [
  helloReplySchema,
  handoffReplySchema,
  jobReplySchema,
  assetChunkReplySchema,
  ackReplySchema,
  captureReadyReplySchema,
  captureDoneReplySchema,
  errorReplySchema,
]);
export type DesktopReply = z.infer<typeof desktopReplySchema>;

/** Which reply answers which request; any other reply is a protocol error. */
export const EXPECTED_REPLY = {
  hello: 'hello.reply',
  'handoff.fetch': 'handoff.reply',
  'job.fetch': 'job.reply',
  'asset.read': 'asset.chunk',
  'job.update': 'ack',
  'capture.begin': 'capture.ready',
  'capture.chunk': 'ack',
  'capture.end': 'capture.done',
  'batch.progress': 'ack',
  'batch.stopped': 'ack',
} as const satisfies Record<CompanionRequestType, DesktopReply['type']>;

export type ReplyFor<T extends CompanionRequestType> = Extract<
  DesktopReply,
  { type: (typeof EXPECTED_REPLY)[T] }
>;

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
  'job-expired':
    'This job has expired or was already opened. Send it from Drama Studio again.',
  'job-not-found':
    'Drama Studio no longer has this job or one of its files. Send it again.',
  'capture-refused':
    'Drama Studio could not take this file right now. Try again in a moment.',
  'capture-corrupt':
    'The file did not arrive complete, so it was not kept. Try sending it again.',
  'too-large': 'This file is too large to send to Drama Studio.',
};
