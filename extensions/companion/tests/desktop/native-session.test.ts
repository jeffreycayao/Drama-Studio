import { describe, expect, it, vi } from 'vitest';

import { companionRequestSchema } from '../../src/desktop/contracts';
import {
  base64ToBytes,
  bytesToBase64,
  sha256Hex,
} from '../../src/desktop/bytes';
import {
  NativeHostClient,
  type NativeClientDependencies,
  type NativePortLike,
} from '../../src/desktop/native-client';

type Message = Record<string, unknown>;
type Responder = (message: Message) => unknown;

/** A fake host: answers each request with `respond`, records everything. */
function fakeHost(respond: Responder) {
  const ports: Array<{ sent: Message[]; disconnect: () => void }> = [];
  let counter = 0;
  const dependencies: NativeClientDependencies = {
    hasPermission: async () => true,
    lastErrorMessage: () => undefined,
    createId: () => `request-${String((counter += 1)).padStart(4, '0')}`,
    connect: () => {
      const messageListeners: Array<(message: unknown) => void> = [];
      const disconnectListeners: Array<() => void> = [];
      const record = { sent: [] as Message[], disconnect: vi.fn() };
      ports.push(record);
      const port: NativePortLike = {
        postMessage: (message) => {
          record.sent.push(message as Message);
          queueMicrotask(() => {
            const reply = respond(message as Message);
            if (reply === 'disconnect') {
              disconnectListeners.forEach((listener) => listener());
            } else if (reply !== undefined) {
              messageListeners.forEach((listener) => listener(reply));
            }
          });
        },
        disconnect: record.disconnect,
        onMessage: {
          addListener: (listener) => messageListeners.push(listener),
        },
        onDisconnect: {
          addListener: (listener) => disconnectListeners.push(listener),
        },
      };
      return port;
    },
  };
  return { client: new NativeHostClient(dependencies, 100), ports };
}

const bytesOf = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, index) => (index * 7) % 256);

describe('base64 and hashing helpers', () => {
  it('round-trips bytes larger than one String.fromCharCode slice', () => {
    const bytes = bytesOf(100_000);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('hashes like the desktop', async () => {
    await expect(sha256Hex(new TextEncoder().encode('test'))).resolves.toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
  });
});

describe('native session', () => {
  it('keeps the old protocol number on hello so older Drama Studio still answers', async () => {
    const { client, ports } = fakeHost((message) => ({
      type: 'hello.reply',
      id: message.id,
      appVersion: '0.1.25',
      paired: true,
    }));
    await client.hello('0.2.0', 'Chrome 141');
    expect(ports[0]?.sent[0]).toMatchObject({ type: 'hello', protocol: 1 });
  });

  it('sends job requests as protocol 2 in the shared format', async () => {
    const { client, ports } = fakeHost((message) => ({
      type: 'job.reply',
      id: message.id,
      jobId: 'job_01234567',
      site: 'grok-imagine',
      kind: 'video',
      prompt: 'A lantern',
      params: { aspect: '9:16' },
      references: [],
    }));
    const result = await client.fetchJob(
      'job_0123456789abcdefABCDEF',
      (site) => site === 'grok-imagine',
    );
    expect(result).toEqual({
      ok: true,
      value: {
        jobId: 'job_01234567',
        site: 'grok-imagine',
        kind: 'video',
        prompt: 'A lantern',
        params: { aspect: '9:16' },
        references: [],
      },
    });
    const sent = ports[0]?.sent[0];
    expect(sent).toMatchObject({ type: 'job.fetch', protocol: 2 });
    expect(companionRequestSchema.safeParse(sent).success).toBe(true);
    expect(ports[0]?.disconnect).toHaveBeenCalled();
  });

  it('refuses a job for a site this tab is not on', async () => {
    const { client } = fakeHost((message) => ({
      type: 'job.reply',
      id: message.id,
      jobId: 'job_01234567',
      site: 'grok-imagine',
      kind: 'image',
      prompt: 'x',
      params: {},
      references: [],
    }));
    await expect(
      client.fetchJob('job_0123456789abcdefABCDEF', () => false),
    ).resolves.toEqual({
      ok: false,
      code: 'handoff-wrong-site',
    });
  });

  it('treats the wrong reply type for a request as a protocol error', async () => {
    const { client } = fakeHost((message) => ({ type: 'ack', id: message.id }));
    await expect(
      client.fetchJob('job_0123456789abcdefABCDEF', () => true),
    ).resolves.toEqual({
      ok: false,
      code: 'protocol',
    });
  });

  it('reads a reference in pieces over one port', async () => {
    const file = bytesOf(1_200_000);
    const { client, ports } = fakeHost((message) => {
      const offset = message.offset as number;
      const piece = file.subarray(offset, offset + 512 * 1024);
      return {
        type: 'asset.chunk',
        id: message.id,
        jobId: message.jobId,
        refId: message.refId,
        offset,
        data: bytesToBase64(piece),
        done: offset + piece.length >= file.length,
        bytes: file.length,
      };
    });
    const result = await client.readReference('job_01234567', {
      refId: 'ref_01234567',
      name: 'still.png',
      mime: 'image/png',
      bytes: file.length,
    });
    expect(result.ok && result.value).toEqual(file);
    expect(ports).toHaveLength(1);
    expect(ports[0]?.sent.map((message) => message.offset)).toEqual([
      0, 524288, 1048576,
    ]);
  });

  it('refuses a reference piece from the wrong offset', async () => {
    const { client } = fakeHost((message) => ({
      type: 'asset.chunk',
      id: message.id,
      jobId: message.jobId,
      refId: message.refId,
      offset: 4,
      data: 'aGVsbG8=',
      done: true,
      bytes: 10,
    }));
    await expect(
      client.readReference('job_01234567', {
        refId: 'ref_01234567',
        name: 'a',
        mime: 'image/png',
        bytes: 10,
      }),
    ).resolves.toEqual({ ok: false, code: 'protocol' });
  });

  it('sends a capture as begin, ordered chunks and end on one port', async () => {
    const file = bytesOf(200_000);
    const received: Uint8Array[] = [];
    const { client, ports } = fakeHost((message) => {
      if (message.type === 'capture.begin') {
        return {
          type: 'capture.ready',
          id: message.id,
          captureId: 'cap_01234567',
          chunkBytes: 65536,
        };
      }
      if (message.type === 'capture.chunk') {
        received.push(base64ToBytes(message.data as string));
        return { type: 'ack', id: message.id };
      }
      return {
        type: 'capture.done',
        id: message.id,
        captureId: 'cap_01234567',
      };
    });

    const result = await client.sendCapture({
      jobId: 'job_01234567',
      site: 'grok-imagine',
      prompt: 'A lantern',
      mime: 'video/mp4',
      name: 'lantern.mp4',
      bytes: file,
    });

    expect(result).toEqual({ ok: true, value: { captureId: 'cap_01234567' } });
    expect(ports).toHaveLength(1);
    const sent = ports[0]?.sent ?? [];
    expect(sent.map((message) => message.type)).toEqual([
      'capture.begin',
      'capture.chunk',
      'capture.chunk',
      'capture.chunk',
      'capture.chunk',
      'capture.end',
    ]);
    expect(
      sent.filter((m) => m.type === 'capture.chunk').map((m) => m.index),
    ).toEqual([0, 1, 2, 3]);
    expect(sent[0]).toMatchObject({
      bytes: file.length,
      sha256: await sha256Hex(file),
    });
    sent.forEach((message) =>
      expect(companionRequestSchema.safeParse(message).success).toBe(true),
    );
    const joined = new Uint8Array(
      received.reduce((sum, part) => sum + part.length, 0),
    );
    received.reduce(
      (offset, part) => (joined.set(part, offset), offset + part.length),
      0,
    );
    expect(joined).toEqual(file);
  });

  it('stops a capture at the first refused chunk', async () => {
    const { client, ports } = fakeHost((message) => {
      if (message.type === 'capture.begin') {
        return {
          type: 'capture.ready',
          id: message.id,
          captureId: 'cap_01234567',
          chunkBytes: 65536,
        };
      }
      return { type: 'error', id: message.id, code: 'capture-corrupt' };
    });
    await expect(
      client.sendCapture({
        jobId: null,
        site: 'grok',
        prompt: null,
        mime: 'image/png',
        name: 'a.png',
        bytes: bytesOf(200_000),
      }),
    ).resolves.toEqual({ ok: false, code: 'capture-corrupt' });
    expect(ports[0]?.sent.map((message) => message.type)).toEqual([
      'capture.begin',
      'capture.chunk',
    ]);
  });

  it('refuses an empty or oversized capture before connecting', async () => {
    const { client, ports } = fakeHost(() => undefined);
    await expect(
      client.sendCapture({
        jobId: null,
        site: 'grok',
        prompt: null,
        mime: 'image/png',
        name: 'a',
        bytes: new Uint8Array(0),
      }),
    ).resolves.toEqual({ ok: false, code: 'capture-refused' });
    const huge = { length: 1024 * 1024 * 1024 + 1 } as Uint8Array;
    await expect(
      client.sendCapture({
        jobId: null,
        site: 'grok',
        prompt: null,
        mime: 'video/mp4',
        name: 'a',
        bytes: huge,
      }),
    ).resolves.toEqual({ ok: false, code: 'too-large' });
    expect(ports).toHaveLength(0);
  });

  it('fails every pending request when the host goes away', async () => {
    const { client } = fakeHost(() => 'disconnect');
    await expect(
      client.updateJob('job_01234567', 'waiting-user'),
    ).resolves.toEqual({
      ok: false,
      code: 'app-not-running',
    });
  });

  it('answers a session request after close without posting', async () => {
    const { client, ports } = fakeHost((message) => ({
      type: 'ack',
      id: message.id,
    }));
    const opened = await client.openSession();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    opened.value.close();
    await expect(
      opened.value.request('job.update', {
        jobId: 'job_01234567',
        state: 'done',
      }),
    ).resolves.toEqual({ ok: false, code: 'app-not-running' });
    expect(ports[0]?.sent).toHaveLength(0);
  });
});
