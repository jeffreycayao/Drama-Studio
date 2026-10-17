export interface BoundedJsonOptions {
  maxBytes: number;
  sizeErrorMessage: string;
  invalidJsonMessage: string;
}

export interface DeadlineSignal {
  signal: AbortSignal;
  dispose: () => void;
}

function assertPositiveLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Response byte limit must be a positive safe integer.');
  }
}

export function createDeadlineSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMilliseconds: number,
): DeadlineSignal {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new Error('Request timeout must be a positive safe integer.');
  }

  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const timer = globalThis.setTimeout(
    () =>
      controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMilliseconds,
  );

  return {
    signal: controller.signal,
    dispose: () => {
      globalThis.clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

export async function readBoundedJson(
  response: Response,
  options: BoundedJsonOptions,
): Promise<unknown> {
  assertPositiveLimit(options.maxBytes);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    await response.body?.cancel(options.sizeErrorMessage);
    throw new Error(options.sizeErrorMessage);
  }

  if (!response.body) {
    throw new Error(options.invalidJsonMessage);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel(options.sizeErrorMessage);
        throw new Error(options.sizeErrorMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error(options.invalidJsonMessage);
  }
}
