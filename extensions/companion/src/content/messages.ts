import {
  contentRequestSchema,
  preparedImageSchema,
  type ContentRequest,
  type PreparedImage,
} from '../protocol/content';
import {
  IMAGE_TRANSFER_TIMEOUT_MS,
  MAX_CONCURRENT_IMAGE_TRANSFERS,
  MAX_IMAGE_SERIALIZED_CHARS,
  MAX_PREPARED_IMAGE_TOTAL_CHARS,
  MAX_UPLOADED_IMAGE_FILES,
} from '../security/image-limits';
import { checkGrokHealth, detectGrokPageStop } from './guard';
import { isGrokPage } from './page';
import { enqueuePromptGroup, reclaimPreparedImagesForGroup } from './queue';
import {
  downloadQueue,
  imageChunkBuffers,
  preparedImages,
  promptGroupQueue,
} from './state';
import { publishPromptGroupStatus } from './status';
import type { SendResponse } from './types';

const PREPARED_IMAGE_TIMEOUT_MS = 5 * 60_000;

function cleanupExpiredImageTransfers(now = Date.now()): void {
  for (const [key, buffer] of Object.entries(imageChunkBuffers)) {
    if (now - buffer.updatedAt > IMAGE_TRANSFER_TIMEOUT_MS) {
      delete imageChunkBuffers[key];
    }
  }
}

function storePreparedImage(id: string, image: PreparedImage): string | null {
  const existing = preparedImages[id];
  const otherImages = Object.entries(preparedImages).filter(
    ([candidateId]) => candidateId !== id,
  );
  if (!existing && otherImages.length >= MAX_UPLOADED_IMAGE_FILES) {
    return 'Too many prepared images';
  }
  const totalChars = otherImages.reduce(
    (total, [, candidate]) => total + candidate.base64.length,
    image.base64.length,
  );
  if (totalChars > MAX_PREPARED_IMAGE_TOTAL_CHARS) {
    return 'Prepared images exceed the aggregate size limit';
  }
  preparedImages[id] = image;
  globalThis.setTimeout(() => {
    if (preparedImages[id] === image) delete preparedImages[id];
  }, PREPARED_IMAGE_TIMEOUT_MS);
  return null;
}

function scheduleImageTransferCleanup(
  key: string,
  expected: (typeof imageChunkBuffers)[string],
): void {
  globalThis.setTimeout(() => {
    const current = imageChunkBuffers[key];
    if (
      current === expected &&
      Date.now() - current.updatedAt >= IMAGE_TRANSFER_TIMEOUT_MS
    ) {
      delete imageChunkBuffers[key];
    }
  }, IMAGE_TRANSFER_TIMEOUT_MS);
}

function prepareImage(
  message: Extract<ContentRequest, { type: 'PREPARE_IMAGE' }>,
  respond: SendResponse,
): void {
  cleanupExpiredImageTransfers();
  const error = storePreparedImage(message.id, message.data);
  respond(error ? { success: false, error } : { success: true });
}

function prepareImageChunk(
  message: Extract<ContentRequest, { type: 'PREPARE_IMAGE_CHUNK' }>,
  respond: SendResponse,
): void {
  const now = Date.now();
  cleanupExpiredImageTransfers(now);
  if (
    !Number.isInteger(message.chunkIndex) ||
    !Number.isInteger(message.totalChunks) ||
    message.totalChunks < 1 ||
    message.chunkIndex < 0 ||
    message.chunkIndex >= message.totalChunks
  ) {
    respond({ success: false, error: 'Invalid image chunk metadata' });
    return;
  }
  const key = `img-${message.id}`;
  const existing = imageChunkBuffers[key];
  if (existing && existing.totalChunks !== message.totalChunks) {
    delete imageChunkBuffers[key];
    respond({
      success: false,
      error: 'Image chunk count changed during transfer',
    });
    return;
  }
  if (
    !existing &&
    Object.keys(imageChunkBuffers).length >= MAX_CONCURRENT_IMAGE_TRANSFERS
  ) {
    respond({ success: false, error: 'Too many concurrent image transfers' });
    return;
  }
  const buffer = existing ?? {
    chunks: Array<string | undefined>(message.totalChunks),
    totalChunks: message.totalChunks,
    receivedCount: 0,
    totalChars: 0,
    updatedAt: now,
  };
  imageChunkBuffers[key] = buffer;
  const priorChunk = buffer.chunks[message.chunkIndex];
  if (priorChunk !== undefined && priorChunk !== message.chunk) {
    delete imageChunkBuffers[key];
    respond({ success: false, error: 'Image chunk changed during transfer' });
    return;
  }
  if (priorChunk === undefined) {
    buffer.chunks[message.chunkIndex] = message.chunk;
    buffer.receivedCount += 1;
    buffer.totalChars += message.chunk.length;
  }
  buffer.updatedAt = now;
  scheduleImageTransferCleanup(key, buffer);
  if (buffer.totalChars > MAX_IMAGE_SERIALIZED_CHARS) {
    delete imageChunkBuffers[key];
    respond({
      success: false,
      error: 'Image transfer exceeded the size limit',
    });
    return;
  }
  if (buffer.receivedCount !== message.totalChunks) {
    respond({
      success: true,
      chunkReceived: true,
      receivedCount: buffer.receivedCount,
      totalChunks: message.totalChunks,
    });
    return;
  }

  try {
    const parsedJson: unknown = JSON.parse(
      buffer.chunks.map((chunk) => chunk ?? '').join(''),
    );
    const parsedImage = preparedImageSchema.safeParse(parsedJson);
    if (!parsedImage.success) throw new Error('Invalid prepared image');
    const error = storePreparedImage(message.id, parsedImage.data);
    if (error) throw new Error(error);
    delete imageChunkBuffers[key];
    respond({ success: true });
  } catch {
    delete imageChunkBuffers[key];
    respond({ success: false, error: 'Failed to parse image chunks' });
  }
}

export function cancelPromptGroup(groupId: string): Record<string, unknown> {
  const queueIndex = promptGroupQueue.findIndex(
    (candidate) => candidate.id === groupId,
  );
  const group = promptGroupQueue[queueIndex];
  if (!group) return { success: false, error: 'Prompt group not found' };

  if (group.status === 'queued') {
    group.status = 'cancelled';
    promptGroupQueue.splice(queueIndex, 1);
    reclaimPreparedImagesForGroup(group.id);
    publishPromptGroupStatus(group);
    return { success: true, cancelled: true };
  }
  if (group.status === 'running') {
    group.isCancelling = true;
    downloadQueue
      .filter((candidate) => candidate.id === groupId)
      .forEach((downloadGroup) => {
        downloadGroup.isCancelling = true;
      });
    publishPromptGroupStatus(group);
    return { success: true, cancelling: true };
  }
  return { success: false, error: 'Prompt group is already finished' };
}

export function handleRuntimeMessage(
  unknownMessage: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): boolean {
  const parsed = contentRequestSchema.safeParse(unknownMessage);
  if (!parsed.success) return false;

  const message = parsed.data;
  switch (message.type) {
    case 'PREPARE_IMAGE':
      prepareImage(message, sendResponse);
      return false;
    case 'PREPARE_IMAGE_CHUNK':
      prepareImageChunk(message, sendResponse);
      return false;
    case 'AUTO_FILL_GROK':
      enqueuePromptGroup(message, sendResponse);
      return false;
    case 'CANCEL_PROMPT_GROUP':
      sendResponse(cancelPromptGroup(message.groupId));
      return false;
    case 'CHECK_GROK_PAGE': {
      const stop = detectGrokPageStop();
      sendResponse({
        isGrokPage: isGrokPage(),
        health: checkGrokHealth(),
        ...(stop ? { stop } : {}),
      });
      return false;
    }
  }
}

export function installRuntimeMessageListener(): () => void {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
}
