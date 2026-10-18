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
import {
  CAPTURE_BUTTON_NO_ACCESS_MESSAGE,
  CAPTURE_DOWNLOAD_FAILED_MESSAGE,
  CAPTURE_MENU_ID,
  CAPTURE_SENT_MESSAGE,
  CAPTURE_UNSUPPORTED_MESSAGE,
  aiSitesForPage,
  capturePatterns,
  fetchMediaWithLimit,
  mediaUrlCheck,
  sendCaptureToDesktop,
} from '../src/background/capture';
import { createTabJobs } from '../src/background/tab-jobs';
import { browserLabel } from '../src/desktop/browser-label';
import { NativeHostClient } from '../src/desktop/native-client';
import {
  desktopRuntimeMessageSchema,
  type AckResponse,
  type CaptureMediaResponse,
  type CompanionNotice,
  type HandoffResponse,
  type HelloResponse,
  type JobResponse,
  type ReferenceChunkResponse,
} from '../src/desktop/messages';
import { jobSiteRunsOn } from '../src/sites/job-sites';
import { backgroundMessageSchema } from '../src/protocol/background';
import {
  AI_SITE_MEDIA_PATTERNS,
  aiSitesOnPromptSite,
} from '../src/sites/ai-sites';
import { PROMPT_SITES } from '../src/sites/prompt-sites';

const LOG_PREFIX = '[Drama Studio Companion]';
// "Send to Drama Studio" is offered on the AI image and video sites, for
// media from each site's own hosts (src/sites/ai-sites.ts).
const CAPTURE_DOCUMENT_PATTERNS = [
  ...new Set(
    PROMPT_SITES.filter(
      (site) => aiSitesOnPromptSite(site.id).length > 0,
    ).flatMap((site) => site.hostnames.map((host) => `https://${host}/*`)),
  ),
];

export default defineBackground(() => {
  let downloadPreferences: DownloadPreferences = defaultDownloadPreferences;
  const desktop = new NativeHostClient();
  const tabJobs = createTabJobs(chrome.storage.session);

  const notifyTab = (tabId: number | undefined, message: string): void => {
    if (tabId === undefined || tabId < 0) return;
    const notice: CompanionNotice = { type: 'COMPANION_NOTICE', message };
    void chrome.tabs.sendMessage(tabId, notice).catch(() => {
      // No Companion script on that page; nothing to show.
    });
  };

  const configureCaptureMenu = async (): Promise<void> => {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: CAPTURE_MENU_ID,
      title: 'Send to Drama Studio',
      contexts: ['image', 'video', 'audio'],
      documentUrlPatterns: CAPTURE_DOCUMENT_PATTERNS,
      targetUrlPatterns: [...AI_SITE_MEDIA_PATTERNS],
    });
  };

  /**
   * Shared by the right-click menu and the on-page button: download one
   * result from the page's own media hosts and hand it to Drama Studio.
   */
  const captureFromPage = async (
    srcUrl: string | undefined,
    pageUrl: string | undefined,
    tabId: number | undefined,
    hasAccess: () => Promise<boolean>,
    noAccessMessage?: string,
  ): Promise<string> => {
    const sameSite = mediaUrlCheck(
      aiSitesForPage(pageUrl).flatMap((site) => site.mediaHosts),
    );
    const tabJob =
      tabId === undefined ? null : await tabJobs.get(tabId).catch(() => null);
    return sendCaptureToDesktop(
      { srcUrl, pageUrl, tabJob },
      {
        hasAccess,
        ...(noAccessMessage ? { noAccessMessage } : {}),
        fetchMedia: (url, maxBytes) =>
          fetchMediaWithLimit(url, maxBytes, fetch, sameSite),
        send: (capture) => desktop.sendCapture(capture),
      },
    );
  };

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CAPTURE_MENU_ID) return;
    const tabId = tab?.id;
    // Chrome only shows its "Allow" prompt during the click itself, so ask
    // before anything is awaited. Already-granted hosts answer at once.
    const patterns = capturePatterns(info.srcUrl, info.pageUrl);
    const access: Promise<boolean> =
      patterns.length > 0
        ? chrome.permissions.request({ origins: patterns }).catch(() => false)
        : Promise.resolve(false);
    void captureFromPage(info.srcUrl, info.pageUrl, tabId, () => access)
      .then((message) => notifyTab(tabId, message))
      .catch((error: unknown) => {
        console.error(`${LOG_PREFIX} Capture failed`, error);
      });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void tabJobs.forget(tabId).catch(() => {});
  });

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
      await configureCaptureMenu().catch((error: unknown) => {
        console.error(`${LOG_PREFIX} Failed to add the capture menu`, error);
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
    sendResponse: (
      response:
        | HandoffResponse
        | HelloResponse
        | JobResponse
        | AckResponse
        | CaptureMediaResponse
        | ReferenceChunkResponse,
    ) => void,
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

    if (message.type === 'DESKTOP_JOB_FETCH') {
      const site = promptSiteOfContentSender(sender, chrome.runtime.id);
      const tabId = sender.tab?.id;
      if (!site || tabId === undefined) {
        sendResponse({ ok: false, code: 'protocol' });
        return false;
      }
      void desktop
        .fetchJob(message.token, (jobSite) => jobSiteRunsOn(jobSite, site.id))
        .then(async (result) => {
          if (!result.ok) {
            sendResponse({ ok: false, code: result.code });
            return;
          }
          const job = result.value;
          await tabJobs
            .remember(tabId, {
              jobId: job.jobId,
              site: job.site,
              prompt: job.prompt,
            })
            .catch(() => {});
          sendResponse({ ok: true, ...job });
        });
      return true;
    }

    if (message.type === 'DESKTOP_JOB_REFERENCE') {
      const site = promptSiteOfContentSender(sender, chrome.runtime.id);
      const tabId = sender.tab?.id;
      if (!site || tabId === undefined) {
        sendResponse({ ok: false, code: 'protocol' });
        return false;
      }
      void (async () => {
        // A tab may only read the references of the job it fetched.
        const tabJob = await tabJobs.get(tabId).catch(() => null);
        if (tabJob?.jobId !== message.jobId) {
          sendResponse({ ok: false, code: 'job-not-found' });
          return;
        }
        const result = await desktop.readReferenceChunk(
          message.jobId,
          message.refId,
          message.offset,
        );
        sendResponse(
          result.ok
            ? { ok: true, ...result.value }
            : { ok: false, code: result.code },
        );
      })();
      return true;
    }

    if (message.type === 'DESKTOP_CAPTURE_MEDIA') {
      const site = promptSiteOfContentSender(sender, chrome.runtime.id);
      const tabId = sender.tab?.id;
      if (!site || tabId === undefined) {
        sendResponse({ ok: false, message: CAPTURE_UNSUPPORTED_MESSAGE });
        return false;
      }
      // The page is the sender's own top frame, never a URL the page names.
      const pageUrl = sender.url;
      const patterns = capturePatterns(message.srcUrl, pageUrl);
      // A click on the page reaches the worker without the person's
      // gesture, so Chrome cannot ask here; already-allowed hosts only.
      const access =
        patterns.length > 0
          ? chrome.permissions
              .contains({ origins: patterns })
              .catch(() => false)
          : Promise.resolve(false);
      void captureFromPage(
        message.srcUrl,
        pageUrl,
        tabId,
        () => access,
        CAPTURE_BUTTON_NO_ACCESS_MESSAGE,
      )
        .then((text) =>
          sendResponse({ ok: text === CAPTURE_SENT_MESSAGE, message: text }),
        )
        .catch((error: unknown) => {
          console.error(`${LOG_PREFIX} Capture failed`, error);
          sendResponse({ ok: false, message: CAPTURE_DOWNLOAD_FAILED_MESSAGE });
        });
      return true;
    }

    if (message.type === 'DESKTOP_JOB_UPDATE') {
      const site = promptSiteOfContentSender(sender, chrome.runtime.id);
      const tabId = sender.tab?.id;
      if (!site || tabId === undefined) {
        sendResponse({ ok: false, code: 'protocol' });
        return false;
      }
      void (async () => {
        // A tab may only report on the job it fetched.
        const tabJob = await tabJobs.get(tabId).catch(() => null);
        if (tabJob?.jobId !== message.jobId) {
          sendResponse({ ok: false, code: 'job-not-found' });
          return;
        }
        const result = await desktop.updateJob(
          message.jobId,
          message.state,
          message.reason,
        );
        sendResponse(
          result.ok ? { ok: true } : { ok: false, code: result.code },
        );
      })();
      return true;
    }

    if (!isTrustedExtensionPageSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, code: 'protocol' });
      return false;
    }
    void desktop
      .hello(chrome.runtime.getManifest().version, browserLabel(navigator))
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
