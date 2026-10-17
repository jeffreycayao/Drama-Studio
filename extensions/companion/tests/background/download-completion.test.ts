import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DownloadTerminalError,
  downloadResourceToTerminal,
} from '../../src/background/download-completion';

function createDownloadsApi() {
  const listeners = new Set<(delta: chrome.downloads.DownloadDelta) => void>();
  const items = new Map<number, chrome.downloads.DownloadItem>();
  const requests: chrome.downloads.DownloadOptions[] = [];
  const cancel = vi.fn((downloadId: number, callback?: () => void) => {
    const item = items.get(downloadId);
    if (item) item.state = 'interrupted';
    callback?.();
  });
  let nextId = 1;
  const search = vi.fn(
    (
      query: chrome.downloads.DownloadQuery,
      callback: (results: chrome.downloads.DownloadItem[]) => void,
    ) => callback(query.id === undefined ? [] : [items.get(query.id)!]),
  );
  const api = {
    download: vi.fn(
      (
        options: chrome.downloads.DownloadOptions,
        callback: (downloadId?: number) => void,
      ) => {
        const id = nextId++;
        requests.push({ ...options });
        items.set(id, {
          id,
          url: options.url,
          finalUrl: options.url,
          referrer: '',
          filename: options.filename ?? '',
          incognito: false,
          danger: 'safe',
          mime: '',
          startTime: new Date().toISOString(),
          endTime: undefined,
          estimatedEndTime: undefined,
          state: 'in_progress',
          paused: false,
          canResume: false,
          error: undefined,
          bytesReceived: 0,
          totalBytes: 0,
          fileSize: 0,
          exists: true,
          byExtensionId: undefined,
          byExtensionName: undefined,
        });
        callback(id);
      },
    ),
    search,
    cancel,
    onChanged: {
      addListener: (
        listener: (delta: chrome.downloads.DownloadDelta) => void,
      ) => listeners.add(listener),
      removeListener: (
        listener: (delta: chrome.downloads.DownloadDelta) => void,
      ) => listeners.delete(listener),
    },
  } as unknown as typeof chrome.downloads;
  const emitState = (
    id: number,
    state: 'complete' | 'interrupted',
    error?: chrome.downloads.DownloadItem['error'],
  ): void => {
    const item = items.get(id);
    if (item) {
      item.state = state;
      item.error = error;
    }
    for (const listener of listeners) {
      listener({
        id,
        state: { current: state },
        ...(error ? { error: { current: error } } : {}),
      });
    }
  };
  const setStateWithoutEvent = (
    id: number,
    state: 'complete' | 'interrupted' | 'in_progress',
  ): void => {
    const item = items.get(id);
    if (item) item.state = state;
  };
  return {
    api,
    cancel,
    search,
    emitState,
    setStateWithoutEvent,
    listeners,
    requests,
  };
}

beforeEach(() => {
  vi.stubGlobal('chrome', { runtime: { lastError: undefined } });
});

function setRuntimeLastError(message?: string): void {
  Object.defineProperty(chrome.runtime, 'lastError', {
    configurable: true,
    value: message ? { message } : undefined,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('terminal browser download tracking', () => {
  it('does not resolve at ID allocation and waits for terminal complete', async () => {
    const downloads = createDownloadsApi();
    let resolved = false;
    const pending = downloadResourceToTerminal(
      { url: 'https://imgen.x.ai/result.png', filename: 'one.png' },
      undefined,
      10_000,
      downloads.api,
    ).then((id) => {
      resolved = true;
      return id;
    });
    await Promise.resolve();

    expect(resolved).toBe(false);
    downloads.emitState(1, 'complete');

    await expect(pending).resolves.toBe(1);
    expect(downloads.listeners.size).toBe(0);
  });

  it('rejects terminal interrupted downloads for indexed retry', async () => {
    const downloads = createDownloadsApi();
    const pending = downloadResourceToTerminal(
      { url: 'https://vidgen.x.ai/result.mp4', filename: 'one.mp4' },
      undefined,
      10_000,
      downloads.api,
    );
    await Promise.resolve();
    downloads.emitState(1, 'interrupted', 'NETWORK_FAILED');

    await expect(pending).rejects.toThrow(
      'Download interrupted: NETWORK_FAILED',
    );
  });

  it('never retries a user-cancelled browser download', async () => {
    const downloads = createDownloadsApi();
    const result = downloadResourceToTerminal(
      { url: 'https://imgen.x.ai/cancelled.png', filename: 'cancelled.png' },
      undefined,
      10_000,
      downloads.api,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await Promise.resolve();
    downloads.emitState(1, 'interrupted', 'USER_CANCELED');

    await expect(result).resolves.toMatchObject({ retryable: false });
  });

  it('keeps listening when the initial exact-state search fails transiently', async () => {
    const downloads = createDownloadsApi();
    downloads.search.mockImplementationOnce((_query, callback) => {
      setRuntimeLastError('Transient search failure');
      callback([]);
      setRuntimeLastError();
    });
    const pending = downloadResourceToTerminal(
      {
        url: 'https://imgen.x.ai/search-race.png',
        filename: 'search-race.png',
      },
      undefined,
      10_000,
      downloads.api,
    );
    await Promise.resolve();
    downloads.emitState(1, 'complete');

    await expect(pending).resolves.toBe(1);
    expect(downloads.cancel).not.toHaveBeenCalled();
  });

  it('cancels and rejects a download that exceeds the terminal deadline', async () => {
    vi.useFakeTimers();
    const downloads = createDownloadsApi();
    const pending = downloadResourceToTerminal(
      { url: 'https://imgen.x.ai/slow.png', filename: 'slow.png' },
      undefined,
      5_000,
      downloads.api,
    );
    const rejection = expect(pending).rejects.toThrow('before the timeout');
    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(downloads.cancel).toHaveBeenCalledWith(1, expect.any(Function));
    expect(downloads.listeners.size).toBe(0);
  });

  it('resolves a late completion found by exact ID at the deadline without cancelling', async () => {
    vi.useFakeTimers();
    const downloads = createDownloadsApi();
    const pending = downloadResourceToTerminal(
      { url: 'https://imgen.x.ai/late.png', filename: 'late.png' },
      undefined,
      5_000,
      downloads.api,
    );
    await Promise.resolve();
    downloads.setStateWithoutEvent(1, 'complete');
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBe(1);
    expect(downloads.cancel).not.toHaveBeenCalled();
  });

  it('marks an ambiguous cancel failure non-retryable and never allocates a second download', async () => {
    vi.useFakeTimers();
    const downloads = createDownloadsApi();
    downloads.cancel.mockImplementation((_downloadId, callback) => {
      setRuntimeLastError('Cancel failed');
      callback?.();
      setRuntimeLastError();
    });
    const result = downloadResourceToTerminal(
      { url: 'https://imgen.x.ai/ambiguous.png', filename: 'ambiguous.png' },
      undefined,
      5_000,
      downloads.api,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5_000);

    const error = await result;
    expect(error).toBeInstanceOf(DownloadTerminalError);
    expect(error).toMatchObject({ retryable: false });
    expect(downloads.api.download).toHaveBeenCalledOnce();
  });

  it('keeps concurrent same-URL filenames bound to their own download IDs', async () => {
    const downloads = createDownloadsApi();
    const url = 'https://imgen.x.ai/shared.png';
    const first = downloadResourceToTerminal(
      { url, filename: 'first.png' },
      undefined,
      10_000,
      downloads.api,
    );
    const second = downloadResourceToTerminal(
      { url, filename: 'second.png' },
      undefined,
      10_000,
      downloads.api,
    );
    await Promise.resolve();
    downloads.emitState(2, 'complete');
    downloads.emitState(1, 'complete');

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(downloads.requests).toEqual([
      { url, filename: 'first.png' },
      { url, filename: 'second.png' },
    ]);
  });
});
