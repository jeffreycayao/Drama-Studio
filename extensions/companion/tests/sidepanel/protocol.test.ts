import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelPromptGroup,
  createImagePreparationMessages,
  isGrokUrl,
} from '../../src/sidepanel/protocol';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('side-panel wire protocol', () => {
  it('uses a single PREPARE_IMAGE request for small images', () => {
    expect(
      createImagePreparationMessages(
        'small',
        { base64: 'abc', name: 'a.png' },
        100,
      ),
    ).toEqual([
      {
        type: 'PREPARE_IMAGE',
        id: 'small',
        data: { base64: 'abc', name: 'a.png' },
      },
    ]);
  });

  it('splits images over the transport limit and reconstructs the exact JSON', () => {
    const image = { base64: 'x'.repeat(200), name: 'large.png' };
    const messages = createImagePreparationMessages('large', image, 50);
    expect(messages.length).toBeGreaterThan(1);
    expect(
      messages.every((message) => message.type === 'PREPARE_IMAGE_CHUNK'),
    ).toBe(true);
    const reconstructed = messages
      .map((message) =>
        message.type === 'PREPARE_IMAGE_CHUNK' ? message.chunk : '',
      )
      .join('');
    expect(JSON.parse(reconstructed)).toEqual(image);
  });

  it('recognizes only secure Grok origins', () => {
    expect(isGrokUrl('https://grok.com/imagine')).toBe(true);
    expect(isGrokUrl('https://accounts.grok.com/path')).toBe(true);
    expect(isGrokUrl('http://grok.com/imagine')).toBe(false);
    expect(isGrokUrl('https://grok.com.example.test/imagine')).toBe(false);
    expect(isGrokUrl('https://user@grok.com/imagine')).toBe(false);
    expect(isGrokUrl('https://grok.com:8443/imagine')).toBe(false);
  });

  it('cancels a queue on its owning Grok tab even when another tab is active', async () => {
    const sendMessage = vi.fn(
      (
        _tabId: number,
        _message: unknown,
        callback: (response: unknown) => void,
      ) => callback({ success: true }),
    );
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn(async () => [{ id: 999 }]),
        sendMessage,
      },
      runtime: { lastError: undefined },
    });

    await cancelPromptGroup('group-owned', 42);

    expect(sendMessage).toHaveBeenCalledWith(
      42,
      { type: 'CANCEL_PROMPT_GROUP', groupId: 'group-owned' },
      expect.any(Function),
    );
  });
});
