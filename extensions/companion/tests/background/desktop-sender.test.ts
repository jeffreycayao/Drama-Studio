import { describe, expect, it } from 'vitest';

import {
  isTrustedExtensionPageSender,
  promptSiteOfContentSender,
} from '../../src/background/sender';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('desktop-link message senders', () => {
  it('accepts the prompt-fill script in the top frame of a known site', () => {
    expect(
      promptSiteOfContentSender(
        {
          id: EXTENSION_ID,
          frameId: 0,
          url: 'https://chatgpt.com/c/1',
          tab: { id: 7 },
        },
        EXTENSION_ID,
      )?.id,
    ).toBe('chatgpt');
  });

  it.each([
    ['another extension', { id: 'other', frameId: 0 }],
    ['a sub-frame', { id: EXTENSION_ID, frameId: 3 }],
    ['an unknown site', { id: EXTENSION_ID, frameId: 0, host: 'example.com' }],
    ['plain http', { id: EXTENSION_ID, frameId: 0, scheme: 'http' }],
  ])('rejects %s', (_label, overrides) => {
    const host = 'host' in overrides ? overrides.host : 'claude.ai';
    const scheme = 'scheme' in overrides ? overrides.scheme : 'https';
    expect(
      promptSiteOfContentSender(
        {
          id: overrides.id,
          frameId: overrides.frameId,
          url: `${scheme}://${host}/new`,
          tab: { id: 7 },
        },
        EXTENSION_ID,
      ),
    ).toBeNull();
  });

  it('accepts only this extension’s own pages for the link check', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: EXTENSION_ID,
          url: `chrome-extension://${EXTENSION_ID}/sidepanel.html`,
        },
        EXTENSION_ID,
      ),
    ).toBe(true);
    expect(
      isTrustedExtensionPageSender(
        { id: EXTENSION_ID, url: 'https://claude.ai/', tab: { id: 1 } },
        EXTENSION_ID,
      ),
    ).toBe(false);
  });
});
