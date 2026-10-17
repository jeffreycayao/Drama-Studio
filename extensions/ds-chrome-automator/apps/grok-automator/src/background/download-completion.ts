export const DOWNLOAD_TERMINAL_TIMEOUT_MS = 2 * 60_000;
const DOWNLOAD_CANCEL_CALLBACK_TIMEOUT_MS = 1_000;
const DOWNLOAD_CANCEL_CONFIRM_TIMEOUT_MS = 2_000;
const DOWNLOAD_CANCEL_CONFIRM_INTERVAL_MS = 50;

export class DownloadTerminalError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'DownloadTerminalError';
    this.retryable = retryable;
  }
}

function runtimeErrorMessage(fallback: string): string {
  return chrome.runtime.lastError?.message || fallback;
}

const RETRYABLE_INTERRUPTION_REASONS = new Set([
  'NETWORK_FAILED',
  'NETWORK_TIMEOUT',
  'NETWORK_DISCONNECTED',
  'NETWORK_SERVER_DOWN',
  'SERVER_FAILED',
  'SERVER_UNREACHABLE',
]);

function interruptedError(error?: string): DownloadTerminalError {
  return new DownloadTerminalError(
    error ? `Download interrupted: ${error}` : 'Download interrupted',
    error ? RETRYABLE_INTERRUPTION_REASONS.has(error) : false,
  );
}

function searchExactDownload(
  downloadId: number,
  downloadsApi: typeof chrome.downloads,
): Promise<chrome.downloads.DownloadItem | null> {
  return new Promise((resolve, reject) => {
    downloadsApi.search({ id: downloadId }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || 'Could not inspect download state'));
        return;
      }
      resolve(items.find((item) => item.id === downloadId) ?? null);
    });
  });
}

function cancelExactDownload(
  downloadId: number,
  downloadsApi: typeof chrome.downloads,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: 'Download cancellation timed out' });
    }, DOWNLOAD_CANCEL_CALLBACK_TIMEOUT_MS);
    try {
      downloadsApi.cancel(downloadId, () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        const error = chrome.runtime.lastError;
        resolve(
          error
            ? {
                success: false,
                error: error.message || 'Download cancellation failed',
              }
            : { success: true },
        );
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Download cancellation failed',
      });
    }
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export function waitForDownloadTerminalState(
  downloadId: number,
  signal?: AbortSignal,
  timeoutMs = DOWNLOAD_TERMINAL_TIMEOUT_MS,
  downloadsApi: typeof chrome.downloads = chrome.downloads,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let resolvingDeadline = false;
    const cleanup = (): void => {
      globalThis.clearTimeout(timeout);
      downloadsApi.onChanged.removeListener(onChanged);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const finishFromItem = (
      item: chrome.downloads.DownloadItem | null,
    ): boolean => {
      if (item?.state === 'complete') {
        finish();
        return true;
      }
      if (item?.state === 'interrupted') {
        finish(interruptedError(item.error));
        return true;
      }
      return false;
    };
    const confirmAfterCancel = async (reason: string): Promise<void> => {
      const confirmationDeadline =
        Date.now() + DOWNLOAD_CANCEL_CONFIRM_TIMEOUT_MS;
      do {
        try {
          const item = await searchExactDownload(downloadId, downloadsApi);
          if (item?.state === 'complete') {
            finish();
            return;
          }
          if (item?.state === 'interrupted') {
            finish(
              new DownloadTerminalError(
                `${reason}; cancellation confirmed interrupted`,
                true,
              ),
            );
            return;
          }
        } catch {
          // A later exact terminal event can still disambiguate the outcome.
        }
        if (settled) return;
        await delay(DOWNLOAD_CANCEL_CONFIRM_INTERVAL_MS);
      } while (Date.now() < confirmationDeadline);
      finish(
        new DownloadTerminalError(
          'Download cancellation could not be confirmed; automatic retry is disabled',
          false,
        ),
      );
    };
    const cancelAndConfirm = async (reason: string): Promise<void> => {
      if (settled || resolvingDeadline) return;
      resolvingDeadline = true;
      try {
        try {
          if (
            finishFromItem(await searchExactDownload(downloadId, downloadsApi))
          ) {
            return;
          }
        } catch {
          // Continue to cancellation; success requires a terminal ID-bound state.
        }
        if (settled) return;
        const cancellation = await cancelExactDownload(
          downloadId,
          downloadsApi,
        );
        if (settled) return;
        if (!cancellation.success) {
          try {
            if (
              finishFromItem(
                await searchExactDownload(downloadId, downloadsApi),
              )
            ) {
              return;
            }
          } catch {
            // The unresolved cancellation remains intentionally non-retryable.
          }
          finish(
            new DownloadTerminalError(
              `${reason}; ${cancellation.error ?? 'download cancellation failed'}; automatic retry is disabled`,
              false,
            ),
          );
          return;
        }
        await confirmAfterCancel(reason);
      } finally {
        resolvingDeadline = false;
      }
    };
    const onAbort = (): void => {
      void cancelAndConfirm('Download wait was cancelled');
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId || !delta.state?.current) return;
      if (delta.state.current === 'complete') finish();
      else if (delta.state.current === 'interrupted') {
        finish(interruptedError(delta.error?.current));
      }
    };
    const timeout = globalThis.setTimeout(() => {
      void cancelAndConfirm('Download did not complete before the timeout');
    }, timeoutMs);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    downloadsApi.onChanged.addListener(onChanged);
    signal?.addEventListener('abort', onAbort, { once: true });
    void searchExactDownload(downloadId, downloadsApi)
      .then((item) => {
        if (!settled) finishFromItem(item);
      })
      .catch(() => {
        // A transient initial search failure is not a terminal result. Keep
        // listening; the deadline path will cancel and confirm exact state.
      });
  });
}

export async function downloadResourceToTerminal(
  options: chrome.downloads.DownloadOptions,
  signal?: AbortSignal,
  timeoutMs = DOWNLOAD_TERMINAL_TIMEOUT_MS,
  downloadsApi: typeof chrome.downloads = chrome.downloads,
): Promise<number> {
  const downloadId = await new Promise<number>((resolve, reject) => {
    downloadsApi.download(options, (candidateId) => {
      const error = chrome.runtime.lastError;
      if (error || candidateId === undefined) {
        reject(
          new DownloadTerminalError(
            runtimeErrorMessage('Failed to start browser download'),
            true,
          ),
        );
        return;
      }
      resolve(candidateId);
    });
  });
  await waitForDownloadTerminalState(
    downloadId,
    signal,
    timeoutMs,
    downloadsApi,
  );
  return downloadId;
}
