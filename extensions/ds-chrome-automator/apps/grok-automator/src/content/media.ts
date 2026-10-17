import { domResourceSourceSchema } from '../protocol/content';
import { createDeadlineSignal } from '../security/bounded-json';
import { MAX_PREPARED_IMAGE_DATA_URL_CHARS } from '../security/image-limits';
import { isAllowedGeneratedResourceUrl } from '../security/urls';
import { CANCELLED_ERROR_MESSAGE } from './dom/interactions';
import type { CancellationCheck } from './types';

export const MAX_VIDEO_MEDIA_BYTES = 64 * 1_024 * 1_024;
export const MAX_VIDEO_DURATION_SECONDS = 5 * 60;
export const MAX_VIDEO_DIMENSION = 8_192;
export const MAX_VIDEO_PIXELS = 16_777_216;
const MEDIA_FETCH_TIMEOUT_MS = 30_000;
const MEDIA_DECODE_TIMEOUT_MS = 15_000;
const CANCELLATION_POLL_MS = 100;

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'seeked',
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onEvent = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(video.error ?? new Error('Video load error'));
    };
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason ?? abortError('Media operation aborted'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function readBoundedMediaResponse(
  response: Response,
): Promise<Blob> {
  if (!response.ok) throw new Error('Video request failed.');
  if (!response.url || !isAllowedGeneratedResourceUrl(response.url)) {
    throw new Error('Video response resolved to an unsupported URL.');
  }
  const contentType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim();
  if (!contentType?.startsWith('video/')) {
    throw new Error('Video response used an unsupported content type.');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_VIDEO_MEDIA_BYTES
  ) {
    await response.body?.cancel('Video response exceeded the size limit.');
    throw new Error('Video response exceeded the size limit.');
  }
  if (!response.body) throw new Error('Video response body was unavailable.');

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_VIDEO_MEDIA_BYTES) {
        await reader.cancel('Video response exceeded the size limit.');
        throw new Error('Video response exceeded the size limit.');
      }
      const ownedChunk = new Uint8Array(value.byteLength);
      ownedChunk.set(value);
      chunks.push(ownedChunk.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: contentType });
}

async function videoSourceToLastFrame(
  source: string,
  isCancelled: CancellationCheck,
): Promise<string> {
  const validatedSource = domResourceSourceSchema.parse(source);
  const cancellation = new AbortController();
  const cancellationPoll = globalThis.setInterval(() => {
    if (isCancelled()) cancellation.abort(abortError(CANCELLED_ERROR_MESSAGE));
  }, CANCELLATION_POLL_MS);
  const fetchDeadline = createDeadlineSignal(
    cancellation.signal,
    MEDIA_FETCH_TIMEOUT_MS,
  );
  let objectUrl: string | null = null;
  try {
    if (isCancelled()) throw new Error(CANCELLED_ERROR_MESSAGE);
    const response = await fetch(validatedSource, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: fetchDeadline.signal,
    });
    const blob = await readBoundedMediaResponse(response);
    objectUrl = URL.createObjectURL(blob);
    const decodeDeadline = createDeadlineSignal(
      cancellation.signal,
      MEDIA_DECODE_TIMEOUT_MS,
    );
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.preload = 'metadata';
    try {
      const metadataLoaded = waitForVideoEvent(
        video,
        'loadedmetadata',
        decodeDeadline.signal,
      );
      video.load();
      await metadataLoaded;
      const pixels = video.videoWidth * video.videoHeight;
      if (
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        video.duration > MAX_VIDEO_DURATION_SECONDS ||
        video.videoWidth < 1 ||
        video.videoHeight < 1 ||
        video.videoWidth > MAX_VIDEO_DIMENSION ||
        video.videoHeight > MAX_VIDEO_DIMENSION ||
        !Number.isSafeInteger(pixels) ||
        pixels > MAX_VIDEO_PIXELS
      ) {
        throw new Error('Video metadata exceeded the supported limits.');
      }
      const seeked = waitForVideoEvent(video, 'seeked', decodeDeadline.signal);
      video.currentTime = Math.max(0, video.duration - 0.1);
      await seeked;
      if (isCancelled()) throw new Error(CANCELLED_ERROR_MESSAGE);

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not get canvas context');
      context.drawImage(video, 0, 0);
      const frame = canvas.toDataURL('image/jpeg', 0.95);
      if (frame.length > MAX_PREPARED_IMAGE_DATA_URL_CHARS) {
        throw new Error('Extracted frame exceeded the image size limit.');
      }
      return frame;
    } finally {
      decodeDeadline.dispose();
      video.removeAttribute('src');
      video.load();
    }
  } finally {
    fetchDeadline.dispose();
    globalThis.clearInterval(cancellationPoll);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function isCancellationError(error: unknown): boolean {
  return (
    (error instanceof Error &&
      error.message.includes(CANCELLED_ERROR_MESSAGE)) ||
    (error instanceof DOMException &&
      error.name === 'AbortError' &&
      error.message.includes(CANCELLED_ERROR_MESSAGE))
  );
}

export async function extractLastVideoFrame(
  resources: readonly HTMLVideoElement[],
  isCancelled: CancellationCheck = () => false,
): Promise<string | null> {
  const last = resources.at(-1);
  if (!last?.src) return null;
  try {
    return await videoSourceToLastFrame(last.src, isCancelled);
  } catch (error) {
    if (isCancelled() || isCancellationError(error)) {
      throw new Error(CANCELLED_ERROR_MESSAGE, { cause: error });
    }
    return null;
  }
}

export function sanitizeFilename(value: string): string {
  if (!value) return 'video';
  const normalized = value
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return normalized || 'video';
}
