import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  companionNoticeSchema,
  reportJobState,
  requestHandoff,
  requestJob,
  requestJobReferenceChunk,
  requestMediaCapture,
} from '../src/desktop/messages';
import {
  captureButtonSite,
  mountCaptureButton,
} from '../src/prompt-fill/capture-button';
import {
  askToFillFromLink,
  showCompanionNotice,
} from '../src/prompt-fill/consent-bar';
import { runPromptFill } from '../src/prompt-fill';
import { aiSitesOnPromptSite } from '../src/sites/ai-sites';
import {
  PROMPT_FILL_MATCHES,
  promptSiteForHostname,
} from '../src/sites/prompt-sites';

/**
 * Fills long prompts and Drama Studio browser jobs into AI sites (never
 * presses Send or Generate), shows the background's short notices, and puts
 * "Send to Drama Studio" on the results of sites that have one.
 */
export default defineContentScript({
  matches: PROMPT_FILL_MATCHES,
  runAt: 'document_idle',
  allFrames: false,
  main() {
    chrome.runtime.onMessage.addListener((message: unknown) => {
      const notice = companionNoticeSchema.safeParse(message);
      if (notice.success) showCompanionNotice(notice.data.message);
      return false;
    });
    const promptSite = promptSiteForHostname(window.location.hostname);
    const buttonSite = promptSite
      ? captureButtonSite(aiSitesOnPromptSite(promptSite.id))
      : null;
    if (buttonSite) {
      mountCaptureButton({
        site: buttonSite,
        send: async (srcUrl) => (await requestMediaCapture(srcUrl)).message,
        notify: (message) => {
          showCompanionNotice(message);
        },
      });
    }
    void runPromptFill({
      href: window.location.href,
      document,
      replaceUrl: (url) =>
        window.history.replaceState(window.history.state, '', url),
      fetchHandoff: requestHandoff,
      fetchJob: requestJob,
      fetchReferenceChunk: requestJobReferenceChunk,
      reportJob: reportJobState,
      confirm: (request) => askToFillFromLink(request),
      notify: (message) => {
        showCompanionNotice(message);
      },
    });
  },
});
