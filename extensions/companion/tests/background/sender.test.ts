import { describe, expect, it } from 'vitest';

import { isTrustedGrokContentSender } from '../../src/background/sender';

const extensionId = 'trusted-extension-id';
const trustedSender = {
  id: extensionId,
  frameId: 0,
  url: 'https://grok.com/imagine',
  tab: { id: 42, url: 'https://grok.com/imagine' },
};

describe('background message sender boundary', () => {
  it('accepts this extension top-frame content script on an HTTPS Grok tab', () => {
    expect(isTrustedGrokContentSender(trustedSender, extensionId)).toBe(true);
  });

  it('rejects other extensions, extension pages, subframes, and non-Grok tabs', () => {
    expect(
      isTrustedGrokContentSender(
        { ...trustedSender, id: 'different-extension' },
        extensionId,
      ),
    ).toBe(false);
    expect(
      isTrustedGrokContentSender(
        {
          ...trustedSender,
          url: 'chrome-extension://trusted-extension-id/sidepanel.html',
        },
        extensionId,
      ),
    ).toBe(false);
    expect(
      isTrustedGrokContentSender({ ...trustedSender, frameId: 1 }, extensionId),
    ).toBe(false);
    expect(
      isTrustedGrokContentSender(
        {
          ...trustedSender,
          url: 'https://example.test/',
          tab: { id: 42, url: 'https://example.test/' },
        },
        extensionId,
      ),
    ).toBe(false);
  });

  it('requires a tab ID and rejects disagreement between sender and tab URLs', () => {
    expect(
      isTrustedGrokContentSender(
        { ...trustedSender, tab: { url: 'https://grok.com/imagine' } },
        extensionId,
      ),
    ).toBe(false);
    expect(
      isTrustedGrokContentSender(
        {
          ...trustedSender,
          tab: { id: 42, url: 'https://example.test/' },
        },
        extensionId,
      ),
    ).toBe(false);
  });
});
