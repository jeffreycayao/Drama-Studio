import { z } from 'zod/mini';

import {
  JOB_STATES,
  MAX_REFERENCE_BYTES,
  desktopErrorCodeSchema,
  jobParamsSchema,
  jobReferenceSchema,
  type DesktopErrorCode,
  type JobState,
} from './contracts';

const tokenSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]{16,128}$/));
const jobIdSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/));

/**
 * Messages between the Companion's own contexts (content script or side
 * panel) and the background worker, which owns the native port.
 */
export const desktopRuntimeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('DESKTOP_HANDOFF_FETCH'),
    token: tokenSchema,
  }),
  z.strictObject({ type: z.literal('DESKTOP_HELLO') }),
  z.strictObject({
    type: z.literal('DESKTOP_JOB_FETCH'),
    token: tokenSchema,
  }),
  z.strictObject({
    type: z.literal('DESKTOP_JOB_REFERENCE'),
    jobId: jobIdSchema,
    refId: jobIdSchema,
    offset: z.int().check(z.minimum(0), z.maximum(MAX_REFERENCE_BYTES)),
  }),
  z.strictObject({
    type: z.literal('DESKTOP_JOB_UPDATE'),
    jobId: jobIdSchema,
    state: z.enum(JOB_STATES),
    reason: z.optional(z.string().check(z.maxLength(200))),
  }),
]);
export type DesktopRuntimeMessage = z.infer<typeof desktopRuntimeMessageSchema>;

export const handoffResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), prompt: z.string() }),
  z.strictObject({ ok: z.literal(false), code: desktopErrorCodeSchema }),
]);
export type HandoffResponse = z.infer<typeof handoffResponseSchema>;

export const helloResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    appVersion: z.string(),
    paired: z.boolean(),
  }),
  z.strictObject({ ok: z.literal(false), code: desktopErrorCodeSchema }),
]);
export type HelloResponse = z.infer<typeof helloResponseSchema>;

export const jobResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    jobId: jobIdSchema,
    site: z.string(),
    kind: z.enum(['image', 'video']),
    prompt: z.string(),
    params: jobParamsSchema,
    references: z.array(jobReferenceSchema),
  }),
  z.strictObject({ ok: z.literal(false), code: desktopErrorCodeSchema }),
]);
export type JobResponse = z.infer<typeof jobResponseSchema>;

export const referenceChunkResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    data: z.string(),
    done: z.boolean(),
    bytes: z.int().check(z.minimum(1), z.maximum(MAX_REFERENCE_BYTES)),
    offset: z.int().check(z.minimum(0), z.maximum(MAX_REFERENCE_BYTES)),
  }),
  z.strictObject({ ok: z.literal(false), code: desktopErrorCodeSchema }),
]);
export type ReferenceChunkResponse = z.infer<
  typeof referenceChunkResponseSchema
>;

export const ackResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: desktopErrorCodeSchema }),
]);
export type AckResponse = z.infer<typeof ackResponseSchema>;

/** Background -> content script: a short message for the person. */
export const companionNoticeSchema = z.strictObject({
  type: z.literal('COMPANION_NOTICE'),
  message: z.string().check(z.minLength(1), z.maxLength(500)),
});
export type CompanionNotice = z.infer<typeof companionNoticeSchema>;

async function ask<T>(
  message: unknown,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T | { ok: false; code: DesktopErrorCode }> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(message);
    const parsed = schema.safeParse(response);
    return parsed.success ? parsed.data : { ok: false, code: 'protocol' };
  } catch {
    return { ok: false, code: 'protocol' };
  }
}

/** Content-script side of a browser job. */
export async function requestJob(token: string): Promise<JobResponse> {
  return (await ask(
    { type: 'DESKTOP_JOB_FETCH', token },
    jobResponseSchema,
  )) as JobResponse;
}

/** One piece of a reference file the person picked for this job. */
export async function requestJobReferenceChunk(
  jobId: string,
  refId: string,
  offset: number,
): Promise<ReferenceChunkResponse> {
  return (await ask(
    { type: 'DESKTOP_JOB_REFERENCE', jobId, refId, offset },
    referenceChunkResponseSchema,
  )) as ReferenceChunkResponse;
}

/** Tells Drama Studio how a browser job is going. Best effort. */
export async function reportJobState(
  jobId: string,
  state: JobState,
  reason?: string,
): Promise<AckResponse> {
  return (await ask(
    reason
      ? {
          type: 'DESKTOP_JOB_UPDATE',
          jobId,
          state,
          reason: reason.slice(0, 200),
        }
      : { type: 'DESKTOP_JOB_UPDATE', jobId, state },
    ackResponseSchema,
  )) as AckResponse;
}

/** Content-script side of the hand-off. */
export async function requestHandoff(token: string): Promise<HandoffResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: 'DESKTOP_HANDOFF_FETCH',
      token,
    });
    const parsed = handoffResponseSchema.safeParse(response);
    return parsed.success ? parsed.data : { ok: false, code: 'protocol' };
  } catch {
    return { ok: false, code: 'protocol' satisfies DesktopErrorCode };
  }
}

/** Side-panel side of the link check. */
export async function requestDesktopHello(): Promise<HelloResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: 'DESKTOP_HELLO',
    });
    const parsed = helloResponseSchema.safeParse(response);
    return parsed.success ? parsed.data : { ok: false, code: 'protocol' };
  } catch {
    return { ok: false, code: 'protocol' };
  }
}
