import { sendRuntimeEvent } from '../protocol/runtime';
import { installRuntimeMessageListener } from './messages';
import { isGrokPage } from './page';
import { restoreDurablePromptStages } from './queue';
import { downloadWorkerLoop, promptGroupWorkerLoop } from './workers';

let started = false;

export function startContentScript(): void {
  if (started) return;
  started = true;
  sendRuntimeEvent({ type: 'CONTENT_SCRIPT_RESET' });
  if (isGrokPage())
    setTimeout(
      () => sendRuntimeEvent({ type: 'SET_ZOOM', zoomFactor: 0.8 }),
      0,
    );
  installRuntimeMessageListener();
  void restoreDurablePromptStages()
    .catch((error: unknown) => {
      sendRuntimeEvent({
        type: 'ACTION_LOG',
        data: {
          level: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Durable prompt recovery failed',
          timestamp: Date.now(),
        },
      });
    })
    .finally(() => {
      void promptGroupWorkerLoop();
      void downloadWorkerLoop();
    });
}
