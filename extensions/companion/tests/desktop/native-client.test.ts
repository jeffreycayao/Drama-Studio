import { describe, expect, it, vi } from 'vitest';

import {
  NATIVE_HOST_NAME,
  companionRequestSchema,
} from '../../src/desktop/contracts';
import {
  NativeHostClient,
  type NativeClientDependencies,
  type NativePortLike,
} from '../../src/desktop/native-client';

type Responder = (message: Record<string, unknown>) => unknown;

function fakePort(respond: Responder | null, lastError?: string) {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const sent: unknown[] = [];
  const port: NativePortLike = {
    postMessage: (message) => {
      sent.push(message);
      queueMicrotask(() => {
        if (respond === null) {
          disconnectListeners.forEach((listener) => listener());
          return;
        }
        const reply = respond(message as Record<string, unknown>);
        if (reply !== undefined) {
          messageListeners.forEach((listener) => listener(reply));
        }
      });
    },
    disconnect: vi.fn(),
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    onDisconnect: {
      addListener: (listener) => disconnectListeners.push(listener),
    },
  };
  return { port, sent, lastError };
}

function client(
  options: {
    permission?: boolean;
    respond?: Responder | null;
    lastError?: string;
    timeoutMs?: number;
  } = {},
) {
  const fake = fakePort(
    options.respond === undefined ? () => undefined : options.respond,
    options.lastError,
  );
  const connect = vi.fn(() => fake.port);
  const dependencies: NativeClientDependencies = {
    hasPermission: async () => options.permission ?? true,
    connect,
    lastErrorMessage: () => fake.lastError,
    createId: () => 'request-0001',
  };
  return {
    client: new NativeHostClient(dependencies, options.timeoutMs ?? 50),
    connect,
    fake,
  };
}

describe('native host client', () => {
  it('needs the optional permission first', async () => {
    const { client: native, connect } = client({ permission: false });
    await expect(native.hello('0.1.0', 'Chrome')).resolves.toEqual({
      ok: false,
      code: 'permission-missing',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('says hello in the shared wire format', async () => {
    const {
      client: native,
      connect,
      fake,
    } = client({
      respond: (message) => ({
        type: 'hello.reply',
        id: message.id,
        appVersion: '0.4.0',
        paired: true,
      }),
    });

    await expect(native.hello('0.1.0', 'Chrome')).resolves.toEqual({
      ok: true,
      value: { appVersion: '0.4.0', paired: true },
    });
    expect(connect).toHaveBeenCalledWith(NATIVE_HOST_NAME);
    expect(companionRequestSchema.safeParse(fake.sent[0]).success).toBe(true);
    expect(fake.port.disconnect).toHaveBeenCalled();
  });

  it('reports a missing native host as an update to install', async () => {
    const { client: native } = client({
      respond: null,
      lastError: 'Specified native messaging host not found.',
    });
    await expect(native.hello('0.1.0', 'Chrome')).resolves.toEqual({
      ok: false,
      code: 'host-missing',
    });
  });

  it('times out when nothing answers', async () => {
    const { client: native } = client({ timeoutMs: 20 });
    await expect(native.hello('0.1.0', 'Chrome')).resolves.toEqual({
      ok: false,
      code: 'timeout',
    });
  });

  it('rejects a reply it does not understand', async () => {
    const { client: native } = client({
      respond: () => ({ type: 'hello.reply', id: 'request-0001' }),
    });
    await expect(native.hello('0.1.0', 'Chrome')).resolves.toEqual({
      ok: false,
      code: 'protocol',
    });
  });

  it('returns the hand-off prompt for the right site only', async () => {
    const reply =
      (site: string): Responder =>
      (message) => ({
        type: 'handoff.reply',
        id: message.id,
        prompt: 'A rainy rooftop at dawn',
        site,
      });

    const right = client({ respond: reply('chatgpt') });
    await expect(
      right.client.fetchHandoff('tok_0123456789abcdef', 'chatgpt'),
    ).resolves.toEqual({
      ok: true,
      value: { prompt: 'A rainy rooftop at dawn' },
    });

    const wrong = client({ respond: reply('gemini') });
    await expect(
      wrong.client.fetchHandoff('tok_0123456789abcdef', 'chatgpt'),
    ).resolves.toEqual({ ok: false, code: 'handoff-wrong-site' });
  });

  it('passes desktop error codes through', async () => {
    const { client: native } = client({
      respond: (message) => ({
        type: 'error',
        id: message.id,
        code: 'handoff-expired',
      }),
    });
    await expect(
      native.fetchHandoff('tok_0123456789abcdef', 'claude'),
    ).resolves.toEqual({ ok: false, code: 'handoff-expired' });
  });
});
