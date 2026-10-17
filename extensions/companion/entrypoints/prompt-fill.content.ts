import { defineContentScript } from 'wxt/utils/define-content-script';

import { requestHandoff } from '../src/desktop/messages';
import {
  askToFillFromLink,
  showCompanionNotice,
} from '../src/prompt-fill/consent-bar';
import { runPromptFill } from '../src/prompt-fill';
import { PROMPT_FILL_MATCHES } from '../src/sites/prompt-sites';

/** Fills long prompts into AI chat sites (never presses Send). */
export default defineContentScript({
  matches: PROMPT_FILL_MATCHES,
  runAt: 'document_idle',
  allFrames: false,
  main() {
    void runPromptFill({
      href: window.location.href,
      document,
      replaceUrl: (url) =>
        window.history.replaceState(window.history.state, '', url),
      fetchHandoff: requestHandoff,
      confirm: (request) => askToFillFromLink(request),
      notify: (message) => {
        showCompanionNotice(message);
      },
    });
  },
});
