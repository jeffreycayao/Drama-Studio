import { startContentScript } from '../src/content';
import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
  matches: ['https://grok.com/*'],
  runAt: 'document_end',
  allFrames: false,
  main() {
    startContentScript();
  },
});
