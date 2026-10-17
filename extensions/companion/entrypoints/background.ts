import { defineBackground } from 'wxt/utils/define-background';

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
import {
  isTrustedExtensionPageSender,
  isTrustedGrokContentSender,
  promptSiteOfContentSender,
} from '../src/background/sender';
import { NativeHostClient } from '../src/desktop/native-client';
import {
  desktopRuntimeMessageSchema,
  type HandoffResponse,
  type HelloResponse,
} from '../src/desktop/messages';
import { backgroundMessageSchema } from '../src/protocol/background';

const LOG_PREFIX = '[Drama Studio Companion]';

export default defineBackground(() => {
  let downloadPreferences: DownloadPreferences = defaultDownloadPreferences;
  const desktop = new NativeHostClient();

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
    console.error(`${LOG_PREFIX} Failed to configure side panel`, error);
  });
  void loadDownloadPreferences()
    .then((preferences) => {
      downloadPreferences = preferences;
      synchronizeFilenameListener();
    })
    .catch((error: unknown) => {
      console.error(`${LOG_PREFIX} Failed to restore download settings`, error);
    });

  chrome.runtime.onInstalled.addListener((details) => {
    void (async () => {
      await configureSidePanel().catch((error: unknown) => {
        console.error(`${LOG_PREFIX} Failed to configure side panel`, error);
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
        // Open Grok tabs can be refreshed by hand if Chrome refuses.
        console.error(`${LOG_PREFIX} Failed to refresh Grok tabs`, error);
      }
    })();
  });

  chrome.action.onClicked.addListener((tab) => {
    if (!chrome.sidePanel || tab.id === undefined) return;
    void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => {
      console.error(`${LOG_PREFIX} Failed to open side panel`, error);
    });
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'side-panel') return;
    // An open named port keeps the worker alive while the side panel is open;
    // Chrome cleans it up when the panel closes.
  });

  const handleDesktopMessage = (
    unknownMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: HandoffResponse | HelloResponse) => void,
  ): boolean | undefined => {
    const parsed = desktopRuntimeMessageSchema.safeParse(unknownMessage);
    if (!parsed.success) return undefined;
    const message = parsed.data;

    if (message.type === 'DESKTOP_HANDOFF_FETCH') {
      const site = promptSiteOfContentSender(sender, chrome.runtime.id);
      if (!site) {
        sendResponse({ ok: false, code: 'protocol' });
        return false;
      }
      void desktop
        .fetchHandoff(message.token, site.id)
        .then((result) =>
          sendResponse(
            result.ok
              ? { ok: true, prompt: result.value.prompt }
              : { ok: false, code: result.code },
          ),
        );
      return true;
    }

    if (!isTrustedExtensionPageSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, code: 'protocol' });
      return false;
    }
    void desktop
      .hello(chrome.runtime.getManifest().version, navigator.userAgent)
      .then((result) =>
        sendResponse(
          result.ok
            ? { ok: true, ...result.value }
            : { ok: false, code: result.code },
        ),
      );
    return true;
  };

  chrome.runtime.onMessage.addListener(
    (unknownMessage, sender, sendResponse) => {
      const desktopHandled = handleDesktopMessage(
        unknownMessage,
        sender,
        sendResponse,
      );
      if (desktopHandled !== undefined) return desktopHandled;

      const parsed = backgroundMessageSchema.safeParse(unknownMessage);
      if (!parsed.success) return false;
      if (!isTrustedGrokContentSender(sender, chrome.runtime.id)) {
        sendResponse({ success: false, error: 'Unauthorized message sender' });
        return false;
      }

      const message = parsed.data;
      switch (message.type) {
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
          }
          sendResponse({ success: false, error: 'Tab ID not found' });
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

        case 'PROMPT_GROUP_STATUS':
          // Status is broadcast for the side panel; nothing to do here.
          return false;
      }
    },
  );
});
