import { describe, expect, it } from 'vitest';

import { backgroundMessageSchema } from '../../src/protocol/background';

describe('background wire schema', () => {
  it('preserves the recovered download envelope for trusted media URLs', () => {
    expect(
      backgroundMessageSchema.safeParse({
        type: 'DOWNLOAD_RESOURCE',
        url: 'https://vidgen.x.ai/result.mp4',
        filename: 'result.mp4',
        folder: 'batch-1',
        autoChangeFileName: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a download envelope whose URL crosses the media boundary', () => {
    expect(
      backgroundMessageSchema.safeParse({
        type: 'DOWNLOAD_RESOURCE',
        url: 'https://attacker.test/result.mp4',
        filename: 'result.mp4',
      }).success,
    ).toBe(false);
  });
});
