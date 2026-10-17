import { describe, expect, it } from 'vitest';

import { readBoundedNodeRequest } from '../src/http/node-request.js';

async function* chunks(values: readonly unknown[]) {
  for (const value of values) yield value;
}

describe('bounded Node request reader', () => {
  it('combines supported chunks below the shared limit', async () => {
    await expect(
      readBoundedNodeRequest(chunks(['abc', Buffer.from('def')]), 6),
    ).resolves.toEqual(Buffer.from('abcdef'));
  });

  it('rejects oversized and unsupported chunks', async () => {
    await expect(
      readBoundedNodeRequest(chunks([Buffer.alloc(4), Buffer.alloc(4)]), 7),
    ).rejects.toThrow('too large');
    await expect(
      readBoundedNodeRequest(chunks([{ invalid: true }]), 7),
    ).rejects.toThrow('Unsupported');
  });
});
