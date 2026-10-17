import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  companionNoticeSchema,
  reportJobState,
  requestHandoff,
  requestJob,
} from '../src/desktop/messages';
import {
  askToFillFromLink,
  showCompanionNotice,
} from '../src/prompt-fill/consent-bar';
import { runPromptFill } from '../src/prompt-fill';
import { PROMPT_FILL_MATCHES } from '../src/sites/prompt-sites';

/**
 * Fills long prompts and Drama Studio browser jobs into AI sites (never
 * presses Send or Generate), and shows the background's short notices.
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
    void runPromptFill({
      href: window.location.href,
      document,
      replaceUrl: (url) =>
        window.history.replaceState(window.history.state, '', url),
      fetchHandoff: requestHandoff,
      fetchJob: requestJob,
      reportJob: reportJobState,
      confirm: (request) => askToFillFromLink(request),
      notify: (message) => {
        showCompanionNotice(message);
      },
    });
  },
});
