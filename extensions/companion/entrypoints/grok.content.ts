import { defineContentScript } from 'wxt/utils/define-content-script';

import { startContentScript } from '../src/content';

/** Batch runner for Grok Imagine. */
export default defineContentScript({
  matches: ['https://grok.com/*'],
  runAt: 'document_end',
  allFrames: false,
  main() {
    startContentScript();
  },
});
