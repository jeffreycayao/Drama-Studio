import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelPromptGroup,
  commitPromptGroup,
  createImagePreparationMessages,
  isGrokUrl,
  TAB_MESSAGE_TIMEOUT_MS,
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

  it('reconciles a lost commit response from the durable blocked stage', async () => {
    const acceptanceId = 'run.lost_response_1234567890';
    const sendMessage = vi.fn(
      (
        _tabId: number,
        message: { type: string },
        callback: (response: unknown) => void,
      ) => {
        callback(
          message.type === 'QUERY_PROMPT_GROUP_COMMIT'
            ? { success: true, status: 'blocked', acceptanceId }
            : undefined,
        );
      },
    );
    vi.stubGlobal('chrome', {
      tabs: { sendMessage },
      runtime: { lastError: undefined },
    });

    await expect(
      commitPromptGroup('group-lost-response', acceptanceId, 42),
    ).resolves.toBeUndefined();
    expect(sendMessage.mock.calls.map(([, message]) => message.type)).toEqual([
      'COMMIT_PROMPT_GROUP',
      'QUERY_PROMPT_GROUP_COMMIT',
    ]);
  });

  it('retries a still-pending commit without duplicating the local group', async () => {
    const acceptanceId = 'run.pending_retry_1234567890';
    let commitAttempt = 0;
    const sendMessage = vi.fn(
      (
        _tabId: number,
        message: { type: string },
        callback: (response: unknown) => void,
      ) => {
        if (message.type === 'COMMIT_PROMPT_GROUP') {
          commitAttempt += 1;
          callback(
            commitAttempt === 1
              ? undefined
              : { success: true, status: 'blocked', acceptanceId },
          );
          return;
        }
        callback({ success: true, status: 'pending', acceptanceId });
      },
    );
    vi.stubGlobal('chrome', {
      tabs: { sendMessage },
      runtime: { lastError: undefined },
    });

    await commitPromptGroup('group-pending-retry', acceptanceId, 42);

    expect(commitAttempt).toBe(2);
    expect(sendMessage.mock.calls.map(([, message]) => message.type)).toEqual([
      'COMMIT_PROMPT_GROUP',
      'QUERY_PROMPT_GROUP_COMMIT',
      'COMMIT_PROMPT_GROUP',
    ]);
  });

  it('recovers after a timed-out commit response by querying the exact receipt', async () => {
    vi.useFakeTimers();
    const acceptanceId = 'run.timeout_recovery_1234567890';
    const sendMessage = vi.fn(
      (
        _tabId: number,
        message: { type: string },
        callback: (response: unknown) => void,
      ) => {
        if (message.type === 'COMMIT_PROMPT_GROUP') return;
        callback({ success: true, status: 'blocked', acceptanceId });
      },
    );
    vi.stubGlobal('chrome', {
      tabs: { sendMessage },
      runtime: { lastError: undefined },
    });

    const recovered = commitPromptGroup(
      'group-timeout-recovery',
      acceptanceId,
      42,
    );
    await vi.advanceTimersByTimeAsync(TAB_MESSAGE_TIMEOUT_MS);

    await expect(recovered).resolves.toBeUndefined();
    expect(sendMessage.mock.calls.map(([, message]) => message.type)).toEqual([
      'COMMIT_PROMPT_GROUP',
      'QUERY_PROMPT_GROUP_COMMIT',
    ]);
  });
});
