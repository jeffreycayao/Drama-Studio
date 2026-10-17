import {
  defaultDownloadPreferences,
  loadDownloadPreferences,
  saveDownloadPreferences,
  type DownloadPreferences,
} from '../src/background/download-preferences';
import {
  isSupportedDownloadUrl,
  sanitizeDownloadPath,
} from '../src/background/downloads';
import {
  DownloadTerminalError,
  downloadResourceToTerminal,
} from '../src/background/download-completion';
import { createPromptStageRuntime } from '../src/background/prompt-stage-runtime';
import { createProductionPromptStageStore } from '../src/background/prompt-stage-store';
import { isTrustedGrokContentSender } from '../src/background/sender';
import {
  getRemoteConfig,
  isVersionSupported,
} from '../src/config/remote-config';
import { backgroundMessageSchema } from '../src/protocol/background';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  let downloadPreferences: DownloadPreferences = defaultDownloadPreferences;
  const promptStageRuntime = createPromptStageRuntime(
    createProductionPromptStageStore(),
  );
  const determineFilename: Parameters<
    typeof chrome.downloads.onDeterminingFilename.addListener
  >[0] = (downloadItem, suggest) => {
    const isGrokResource = isSupportedDownloadUrl(downloadItem.url);
    if (
      !isGrokResource ||
      downloadItem.byExtensionId === chrome.runtime.id ||
      (downloadItem.byExtensionId !== undefined &&
        downloadItem.byExtensionId !== chrome.runtime.id) ||
      !downloadPreferences.autoChangeFileName
    ) {
      return;
    }

    const sourceName = downloadItem.filename || downloadItem.url;
    const isVideo = /\.mp4$/i.test(sourceName);
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(sourceName);
    if (!isVideo && !isImage) return;

    const basename = downloadItem.filename.split('/').pop() || 'grok-download';
    const folderPrefix = downloadPreferences.folderName.trim()
      ? `${downloadPreferences.folderName}/`
      : '';
    suggest({
      filename: sanitizeDownloadPath(
        `${folderPrefix}${downloadPreferences.prefix}${basename}`,
        basename,
      ),
    });
  };

  const synchronizeFilenameListener = (): void => {
    const hasListener =
      chrome.downloads.onDeterminingFilename.hasListener(determineFilename);
    if (downloadPreferences.autoChangeFileName && !hasListener) {
      chrome.downloads.onDeterminingFilename.addListener(determineFilename);
    } else if (!downloadPreferences.autoChangeFileName && hasListener) {
      chrome.downloads.onDeterminingFilename.removeListener(determineFilename);
    }
  };

  const configureSidePanel = async (): Promise<void> => {
    if (!chrome.sidePanel) return;
    await chrome.sidePanel.setOptions({
      path: 'sidepanel.html',
      enabled: true,
    });
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
  };

  void configureSidePanel().catch((error: unknown) => {
    console.error('[Grok Automator™] Failed to configure side panel', error);
  });
  void loadDownloadPreferences()
    .then((preferences) => {
      downloadPreferences = preferences;
      synchronizeFilenameListener();
    })
    .catch((error: unknown) => {
      console.error(
        '[Grok Automator™] Failed to restore download settings',
        error,
      );
    });
  void promptStageRuntime.prune().catch((error: unknown) => {
    console.error(
      '[Grok Automator™] Failed to prune blocked prompt stages',
      error,
    );
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void promptStageRuntime.discardTab(tabId).catch((error: unknown) => {
      console.error(
        '[Grok Automator™] Failed to discard a closed-tab prompt stage',
        error,
      );
    });
  });

  chrome.runtime.onInstalled.addListener((details) => {
    void (async () => {
      await configureSidePanel().catch((error: unknown) => {
        console.error(
          '[Grok Automator™] Failed to configure side panel',
          error,
        );
      });
      if (details.reason !== 'install') return;

      try {
        const grokTabs = await chrome.tabs.query({
          url: ['https://grok.com/*'],
        });
        await Promise.all(
          grokTabs.flatMap((tab) =>
            tab.id === undefined ? [] : [chrome.tabs.reload(tab.id)],
          ),
        );
      } catch (error: unknown) {
        // Existing Grok tabs can be refreshed manually if Chrome denies this.
        console.error('[Grok Automator™] Failed to refresh Grok tabs', error);
      }
    })();
  });

  chrome.action.onClicked.addListener((tab) => {
    if (!chrome.sidePanel || tab.id === undefined) return;
    void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => {
      console.error('[Grok Automator™] Failed to open side panel', error);
    });
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'side-panel') return;
    // Chrome owns port lifecycle cleanup; accepting this named port preserves
    // the recovered side-panel keep-alive behavior while the panel is open.
  });

  chrome.runtime.onMessage.addListener(
    (unknownMessage, sender, sendResponse) => {
      const parsed = backgroundMessageSchema.safeParse(unknownMessage);
      if (!parsed.success) return false;
      if (!isTrustedGrokContentSender(sender, chrome.runtime.id)) {
        sendResponse({ success: false, error: 'Unauthorized message sender' });
        return false;
      }

      const message = parsed.data;
      switch (message.type) {
        case 'GET_REMOTE_CONFIG':
          void getRemoteConfig()
            .then((config) =>
              sendResponse(
                isVersionSupported(config, chrome.runtime.getManifest().version)
                  ? config
                  : null,
              ),
            )
            .catch(() => sendResponse(null));
          return true;

        case 'SET_ZOOM':
          if (sender.tab?.id !== undefined) {
            void chrome.tabs
              .setZoom(sender.tab.id, message.zoomFactor)
              .then(() => sendResponse({ success: true }))
              .catch((error: unknown) =>
                sendResponse({
                  success: false,
                  error: error instanceof Error ? error.message : 'Zoom failed',
                }),
              );
            return true;
          } else {
            sendResponse({ success: false, error: 'Tab ID not found' });
          }
          return false;

        case 'DOWNLOAD_RESOURCE': {
          if (!isSupportedDownloadUrl(message.url)) {
            sendResponse({ success: false, error: 'Unsupported download URL' });
            return false;
          }

          const targetName = sanitizeDownloadPath(
            message.folder
              ? `${message.folder}/${message.filename}`
              : message.filename,
            'grok-download',
          );

          void downloadResourceToTerminal({
            url: message.url,
            ...(message.autoChangeFileName === false
              ? {}
              : { filename: targetName }),
            saveAs: false,
          })
            .then((downloadId) => sendResponse({ success: true, downloadId }))
            .catch((error: unknown) =>
              sendResponse({
                success: false,
                error:
                  error instanceof Error ? error.message : 'Download failed',
                ...(error instanceof DownloadTerminalError
                  ? { retryable: error.retryable }
                  : { retryable: false }),
              }),
            );
          return true;
        }

        case 'SET_FOLDER_NAME': {
          downloadPreferences = {
            folderName:
              typeof message.folderName === 'string'
                ? message.folderName.trim()
                : downloadPreferences.folderName,
            prefix:
              typeof message.prefix === 'string'
                ? message.prefix.trim()
                : downloadPreferences.prefix,
            autoChangeFileName:
              typeof message.autoChangeFileName === 'boolean'
                ? message.autoChangeFileName
                : downloadPreferences.autoChangeFileName,
          };
          synchronizeFilenameListener();
          void saveDownloadPreferences(downloadPreferences)
            .then(() => sendResponse({ success: true }))
            .catch((error: unknown) =>
              sendResponse({
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Failed to save download settings',
              }),
            );
          return true;
        }

        case 'PROMPT_GROUP_STATUS': {
          // Status is validated for compatibility. Download preferences remain
          // durable across MV3 service-worker restarts and need no timer cleanup.
          return false;
        }

        case 'STORE_BLOCKED_PROMPT_STAGE_CHUNK':
        case 'LIST_BLOCKED_PROMPT_STAGES':
        case 'READ_BLOCKED_PROMPT_STAGE_CHUNK':
        case 'GET_BLOCKED_PROMPT_STAGE_STATUS':
        case 'MARK_BLOCKED_PROMPT_STAGE_RELEASED':
        case 'MARK_BLOCKED_PROMPT_STAGE_CLAIMED':
        case 'ACK_BLOCKED_PROMPT_STAGE_RELEASED':
        case 'DISCARD_BLOCKED_PROMPT_STAGE': {
          if (sender.tab?.id === undefined) {
            sendResponse({ success: false, error: 'Tab ID not found' });
            return false;
          }
          void promptStageRuntime
            .handle(message, sender.tab.id)
            .then(sendResponse)
            .catch((error: unknown) =>
              sendResponse({
                success: false,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Blocked prompt stage operation failed',
              }),
            );
          return true;
        }
      }
    },
  );
});
