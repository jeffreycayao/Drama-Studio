import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDeadlineSignal,
  readBoundedJson,
} from '../../src/security/bounded-json';

const options = {
  maxBytes: 32,
  sizeErrorMessage: 'response too large',
  invalidJsonMessage: 'invalid response',
};

afterEach(() => vi.useRealTimers());

describe('bounded streaming JSON', () => {
  it('parses incrementally delivered JSON within the byte budget', async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"ok":'));
          controller.enqueue(encoder.encode('true}'));
          controller.close();
        },
      }),
    );

    await expect(readBoundedJson(response, options)).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects declared and streamed bodies before they can grow unbounded', async () => {
    await expect(
      readBoundedJson(
        new Response('{}', { headers: { 'Content-Length': '33' } }),
        options,
      ),
    ).rejects.toThrow('response too large');

    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(20));
          controller.enqueue(new Uint8Array(20));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(readBoundedJson(response, options)).rejects.toThrow(
      'response too large',
    );
    expect(cancelled).toBe(true);
  });

  it('combines parent cancellation with a disposable request deadline', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const deadline = createDeadlineSignal(parent.signal, 100);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(deadline.signal.reason).toBeInstanceOf(DOMException);
    expect((deadline.signal.reason as DOMException).name).toBe('TimeoutError');
    deadline.dispose();

    const parentFirst = new AbortController();
    const inherited = createDeadlineSignal(parentFirst.signal, 1_000);
    parentFirst.abort(new Error('cancelled'));
    expect(inherited.signal.aborted).toBe(true);
    inherited.dispose();
  });
});
