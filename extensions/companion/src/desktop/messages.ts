import { z } from 'zod/mini';

import { desktopErrorCodeSchema, type DesktopErrorCode } from './contracts';

/**
 * Messages between the Companion's own contexts (content script or side
 * panel) and the background worker, which owns the native port.
 */
export const desktopRuntimeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('DESKTOP_HANDOFF_FETCH'),
    token: z.string().check(z.regex(/^[A-Za-z0-9_-]{16,128}$/)),
  }),
  z.strictObject({ type: z.literal('DESKTOP_HELLO') }),
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
