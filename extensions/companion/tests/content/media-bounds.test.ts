// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import {
  MAX_VIDEO_MEDIA_BYTES,
  readBoundedMediaResponse,
} from '../../src/content/media';

function mediaResponse(
  body: BodyInit,
  options: { contentLength?: number; contentType?: string; url?: string } = {},
): Response {
  const headers = new Headers({
    'Content-Type': options.contentType ?? 'video/mp4',
  });
  if (options.contentLength !== undefined) {
    headers.set('Content-Length', String(options.contentLength));
  }
  const response = new Response(body, { status: 200, headers });
  Object.defineProperty(response, 'url', {
    configurable: true,
    value: options.url ?? 'https://vidgen.x.ai/result.mp4',
  });
  return response;
}

describe('generated media response bounds', () => {
  it('accepts a small pinned video response', async () => {
    const blob = await readBoundedMediaResponse(
      mediaResponse(new Uint8Array([0, 1, 2, 3])),
    );
    expect(blob.size).toBe(4);
    expect(blob.type).toBe('video/mp4');
  });

  it('rejects oversized, cross-origin, and non-video responses', async () => {
    await expect(
      readBoundedMediaResponse(
        mediaResponse(new Uint8Array(), {
          contentLength: MAX_VIDEO_MEDIA_BYTES + 1,
        }),
      ),
    ).rejects.toThrow(/size limit/u);
    await expect(
      readBoundedMediaResponse(
        mediaResponse(new Uint8Array(), {
          url: 'https://attacker.example/result.mp4',
        }),
      ),
    ).rejects.toThrow(/unsupported URL/u);
    await expect(
      readBoundedMediaResponse(
        mediaResponse(new Uint8Array(), { contentType: 'text/html' }),
      ),
    ).rejects.toThrow(/content type/u);
  });
});
