import { z } from 'zod/mini';

import { isHttpsGrokUrl } from '../security/urls';
import { GROK_IMAGINE_URL } from '../sites/grok';
import {
  checkGrokPageResponseSchema,
  operationResponseSchema,
  promptPayloadSchema,
  runtimeMessageSchema,
} from './schemas';
import type {
  BatchStop,
  PromptPayload,
  QueueOptions,
  UploadedImage,
} from './types';
import {
  IMAGE_CHUNK_CHAR_LIMIT,
  MAX_IMAGE_SERIALIZED_CHARS,
  MAX_IMAGE_TRANSFER_CHUNKS,
} from '../security/image-limits';

export { GROK_IMAGINE_URL } from '../sites/grok';
export { IMAGE_CHUNK_CHAR_LIMIT } from '../security/image-limits';
export const TAB_MESSAGE_TIMEOUT_MS = 5_000;

export type ImagePreparationMessage =
  | {
      type: 'PREPARE_IMAGE';
      id: string;
      data: { base64: string; name: string };
    }
  | {
      type: 'PREPARE_IMAGE_CHUNK';
      id: string;
      chunk: string;
      chunkIndex: number;
      totalChunks: number;
    };

const activeTabSchema = z.looseObject({
  id: z.number().check(z.int(), z.minimum(0)),
  url: z.optional(z.string()),
});

export function isGrokUrl(value: string | undefined): boolean {
  return isHttpsGrokUrl(value);
}

export function createImagePreparationMessages(
  id: string,
  image: Pick<UploadedImage, 'base64' | 'name'>,
  chunkLimit = IMAGE_CHUNK_CHAR_LIMIT,
): ImagePreparationMessage[] {
  if (!Number.isSafeInteger(chunkLimit) || chunkLimit < 1) {
    throw new Error('Invalid image chunk limit');
  }
  const data = { base64: image.base64, name: image.name };
  const serialized = JSON.stringify(data);
  if (serialized.length > MAX_IMAGE_SERIALIZED_CHARS) {
    throw new Error('Prepared image exceeds the transfer size limit');
  }
  if (serialized.length <= chunkLimit)
    return [{ type: 'PREPARE_IMAGE', id, data }];
  const totalChunks = Math.ceil(serialized.length / chunkLimit);
  if (totalChunks > MAX_IMAGE_TRANSFER_CHUNKS) {
    throw new Error('Prepared image requires too many transfer chunks');
  }
  return Array.from({ length: totalChunks }, (_, chunkIndex) => ({
    type: 'PREPARE_IMAGE_CHUNK' as const,
    id,
    chunk: serialized.slice(
      chunkIndex * chunkLimit,
      (chunkIndex + 1) * chunkLimit,
    ),
    chunkIndex,
    totalChunks,
  }));
}

export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = activeTabSchema.safeParse(tabs[0]);
  if (!parsed.success) throw new Error('No active tab found');
  return tabs[0] as chrome.tabs.Tab;
}

export function sendTabMessage(
  tabId: number,
  message: unknown,
  timeoutMs = TAB_MESSAGE_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The Grok tab did not respond in time.'));
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (response: unknown) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      const error = chrome.runtime.lastError;
      if (error) {
        const detail = error.message ?? 'Content script connection failed';
        reject(
          new Error(
            detail.includes('Receiving end does not exist') ||
              detail.includes('Could not establish connection')
              ? 'Open Grok Imagine and reload the page before starting automation.'
              : detail,
          ),
        );
      } else {
        resolve(response);
      }
    });
  });
}

export interface GrokPageState {
  isGrokPage: boolean;
  /** False when Grok changed and the adapter cannot find its prompt box. */
  healthy: boolean;
  /** A CAPTCHA, limit, moderation or sign-in page on the tab right now. */
  stop?: BatchStop;
}

const NOT_GROK: GrokPageState = { isGrokPage: false, healthy: true };

export async function detectGrokPage(): Promise<GrokPageState> {
  try {
    const tab = await getActiveTab();
    if (!isGrokUrl(tab.url) || tab.id === undefined) return NOT_GROK;
    const response = checkGrokPageResponseSchema.safeParse(
      await sendTabMessage(tab.id, { type: 'CHECK_GROK_PAGE' }),
    );
    if (!response.success) return { isGrokPage: true, healthy: true };
    return {
      isGrokPage: response.data.isGrokPage,
      healthy: response.data.health?.ok ?? true,
      ...(response.data.stop ? { stop: response.data.stop } : {}),
    };
  } catch {
    return NOT_GROK;
  }
}

export async function navigateToGrok(): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: ['https://grok.com/*', 'https://*.grok.com/*'],
  });
  const candidate = tabs.find((tab) => tab.id !== undefined);
  if (candidate?.id !== undefined) {
    await chrome.tabs.update(candidate.id, {
      active: true,
      url: GROK_IMAGINE_URL,
    });
    if (candidate.windowId !== undefined)
      await chrome.windows.update(candidate.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: GROK_IMAGINE_URL });
}

function makePreparedPayloads(payloads: PromptPayload[]): {
  payloads: PromptPayload[];
  images: Map<string, UploadedImage>;
} {
  const images = new Map<string, UploadedImage>();
  const prepared = payloads.map((payload) => {
    if (!payload.images) return payload;
    const imageIds = payload.images.map((image) => {
      const id = image.id || `img-${image.name}-${image.base64.length}`;
      images.set(id, image);
      return id;
    });
    const withoutImages = { ...payload };
    delete withoutImages.images;
    return { ...withoutImages, imageIds };
  });
  return { payloads: prepared, images };
}

export async function queuePromptGroup(
  payloads: PromptPayload[],
  options: QueueOptions,
): Promise<{ groupId: string; tabId: number }> {
  if (payloads.length === 0) throw new Error('Add at least one prompt');
  const validatedPayloads = payloads.map(
    (payload) => promptPayloadSchema.parse(payload) as PromptPayload,
  );
  const groupId =
    options.groupId ??
    `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tab = await getActiveTab();
  if (tab.id === undefined) throw new Error('Active tab has no ID');
  const prepared = makePreparedPayloads(validatedPayloads);

  for (const [id, image] of prepared.images) {
    for (const message of createImagePreparationMessages(id, image)) {
      const response = operationResponseSchema.safeParse(
        await sendTabMessage(tab.id, message),
      );
      if (!response.success || !response.data.success) {
        throw new Error(
          response.success
            ? (response.data.error ?? 'Image preparation failed')
            : 'Invalid image response',
        );
      }
    }
  }

  const response = operationResponseSchema.safeParse(
    await sendTabMessage(tab.id, {
      type: 'AUTO_FILL_GROK',
      payloads: prepared.payloads,
      groupId,
      concurrentPrompts: options.concurrentPrompts,
      promptDelaySecondsMin: options.promptDelaySecondsMin,
      promptDelaySecondsMax: options.promptDelaySecondsMax,
    }),
  );
  if (!response.success || !response.data.success) {
    throw new Error(
      response.success
        ? (response.data.error ?? 'Queue request failed')
        : 'Invalid queue response',
    );
  }
  return { groupId, tabId: tab.id };
}

export async function cancelPromptGroup(
  groupId: string,
  owningTabId?: number,
): Promise<void> {
  const tabId = owningTabId ?? (await getActiveTab()).id;
  if (tabId === undefined) throw new Error('Grok tab has no ID');
  const response = operationResponseSchema.safeParse(
    await sendTabMessage(tabId, {
      type: 'CANCEL_PROMPT_GROUP',
      groupId,
    }),
  );
  if (!response.success || !response.data.success) {
    throw new Error(
      response.success
        ? (response.data.error ?? 'Cancellation failed')
        : 'Invalid cancellation response',
    );
  }
}

export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;

export function parseRuntimeMessage(value: unknown): RuntimeMessage | null {
  const result = runtimeMessageSchema.safeParse(value);
  return result.success ? result.data : null;
}
