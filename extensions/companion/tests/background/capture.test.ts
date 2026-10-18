import { describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_DOWNLOAD_FAILED_MESSAGE,
  CAPTURE_NO_ACCESS_MESSAGE,
  capturePatterns,
  mediaUrlCheck,
  CAPTURE_SENT_MESSAGE,
  CAPTURE_UNSUPPORTED_MESSAGE,
  captureMime,
  captureName,
  fetchMediaWithLimit,
  sendCaptureToDesktop,
} from '../../src/background/capture';
import { createTabJobs } from '../../src/background/tab-jobs';
import { DESKTOP_ERROR_MESSAGES } from '../../src/desktop/contracts';

const media = (
  bytes = new Uint8Array([1, 2, 3]),
  contentType: string | null = 'video/mp4',
) => ({
  bytes,
  contentType,
});

function dependencies(
  overrides: Partial<Parameters<typeof sendCaptureToDesktop>[1]> = {},
) {
  return {
    fetchMedia: vi.fn(async () => media()),
    send: vi.fn(async () => ({
      ok: true as const,
      value: { captureId: 'cap_01234567' },
    })),
    ...overrides,
  };
}

describe('capture: what is sent', () => {
  it('files a capture from a job tab with that job and its prompt', async () => {
    const deps = dependencies();
    const message = await sendCaptureToDesktop(
      {
        srcUrl: 'https://vidgen.x.ai/abc/clip.mp4',
        pageUrl: 'https://grok.com/imagine',
        tabJob: {
          jobId: 'job_01234567',
          site: 'grok-imagine',
          prompt: 'A lantern',
        },
      },
      deps,
    );
    expect(message).toBe(CAPTURE_SENT_MESSAGE);
    expect(deps.send).toHaveBeenCalledWith({
      jobId: 'job_01234567',
      site: 'grok-imagine',
      prompt: 'A lantern',
      mime: 'video/mp4',
      name: 'clip.mp4',
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it('files a capture without a job under the page site', async () => {
    const deps = dependencies({
      fetchMedia: vi.fn(async () =>
        media(undefined, 'image/jpeg; charset=binary'),
      ),
    });
    await sendCaptureToDesktop(
      {
        srcUrl: 'https://imgen.x.ai/a/b/still',
        pageUrl: 'https://grok.com/imagine/post/1',
        tabJob: null,
      },
      deps,
    );
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: null,
        site: 'grok',
        prompt: null,
        mime: 'image/jpeg',
        name: 'still',
      }),
    );
  });

  it('only downloads from the site media hosts', async () => {
    const deps = dependencies();
    for (const srcUrl of [
      'https://evil.example/a.png',
      'http://imgen.x.ai/a.png',
      'blob:https://grok.com/1',
      undefined,
    ]) {
      await expect(
        sendCaptureToDesktop(
          { srcUrl, pageUrl: 'https://grok.com/', tabJob: null },
          deps,
        ),
      ).resolves.toBe(CAPTURE_UNSUPPORTED_MESSAGE);
    }
    expect(deps.fetchMedia).not.toHaveBeenCalled();
  });

  it('refuses a file type Drama Studio does not take', async () => {
    const deps = dependencies({
      fetchMedia: vi.fn(async () => media(undefined, 'text/html')),
    });
    await expect(
      sendCaptureToDesktop(
        {
          srcUrl: 'https://grok.com/page',
          pageUrl: 'https://grok.com/',
          tabJob: null,
        },
        deps,
      ),
    ).resolves.toBe(CAPTURE_UNSUPPORTED_MESSAGE);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('explains failed downloads, oversized files and desktop refusals', async () => {
    const request = {
      srcUrl: 'https://vidgen.x.ai/clip.mp4',
      pageUrl: 'https://grok.com/',
      tabJob: null,
    };
    await expect(
      sendCaptureToDesktop(
        request,
        dependencies({ fetchMedia: vi.fn(async () => null) }),
      ),
    ).resolves.toBe(CAPTURE_DOWNLOAD_FAILED_MESSAGE);
    await expect(
      sendCaptureToDesktop(
        request,
        dependencies({ fetchMedia: vi.fn(async () => 'too-large' as const) }),
      ),
    ).resolves.toBe(DESKTOP_ERROR_MESSAGES['too-large']);
    await expect(
      sendCaptureToDesktop(
        request,
        dependencies({
          send: vi.fn(async () => ({
            ok: false as const,
            code: 'not-paired' as const,
          })),
        }),
      ),
    ).resolves.toBe(DESKTOP_ERROR_MESSAGES['not-paired']);
  });

  it('names and types files from the URL when headers do not say', () => {
    expect(captureMime(null, new URL('https://imgen.x.ai/x/frame.WEBP'))).toBe(
      'image/webp',
    );
    expect(
      captureMime(
        'application/octet-stream',
        new URL('https://vidgen.x.ai/x/c.mov'),
      ),
    ).toBe('video/quicktime');
    expect(captureMime(null, new URL('https://vidgen.x.ai/x/c'))).toBeNull();
    expect(captureName(new URL('https://imgen.x.ai/a/my%20shot%3A1.png'))).toBe(
      'my shot1.png',
    );
    expect(captureName(new URL('https://imgen.x.ai/'))).toBe('capture');
  });
});

describe('capture: downloading with a limit', () => {
  const response = (
    body: Uint8Array<ArrayBuffer>,
    headers: Record<string, string> = {},
    url = 'https://vidgen.x.ai/c.mp4',
  ) => {
    const value = new Response(body, { headers });
    Object.defineProperty(value, 'url', { value: url });
    return value;
  };

  it('reads the body with the person cookies', async () => {
    const fetchImpl = vi.fn(async () =>
      response(new Uint8Array([9, 8, 7]), { 'content-type': 'video/mp4' }),
    );
    await expect(
      fetchMediaWithLimit('https://vidgen.x.ai/c.mp4', 10, fetchImpl),
    ).resolves.toEqual({
      bytes: new Uint8Array([9, 8, 7]),
      contentType: 'video/mp4',
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://vidgen.x.ai/c.mp4', {
      credentials: 'include',
    });
  });

  it('stops at the size limit, declared or not', async () => {
    await expect(
      fetchMediaWithLimit('https://vidgen.x.ai/c.mp4', 2, async () =>
        response(new Uint8Array([1, 2, 3])),
      ),
    ).resolves.toBe('too-large');
    await expect(
      fetchMediaWithLimit('https://vidgen.x.ai/c.mp4', 2, async () =>
        response(new Uint8Array([1]), { 'content-length': '5000' }),
      ),
    ).resolves.toBe('too-large');
  });

  it('refuses a redirect away from the media hosts', async () => {
    await expect(
      fetchMediaWithLimit('https://vidgen.x.ai/c.mp4', 10, async () =>
        response(new Uint8Array([1]), {}, 'https://evil.example/c.mp4'),
      ),
    ).resolves.toBeNull();
  });
});

describe('tab jobs', () => {
  function memoryStorage() {
    const data = new Map<string, unknown>();
    return {
      get: async (key: string) =>
        data.has(key) ? { [key]: data.get(key) } : {},
      set: async (items: Record<string, unknown>) => {
        Object.entries(items).forEach(([key, value]) => data.set(key, value));
      },
      remove: async (key: string) => {
        data.delete(key);
      },
    };
  }

  it('remembers the job per tab until the tab closes', async () => {
    const jobs = createTabJobs(memoryStorage());
    await jobs.remember(7, {
      jobId: 'job_01234567',
      site: 'grok-imagine',
      prompt: 'A lantern',
    });
    await expect(jobs.get(7)).resolves.toEqual({
      jobId: 'job_01234567',
      site: 'grok-imagine',
      prompt: 'A lantern',
    });
    await expect(jobs.get(8)).resolves.toBeNull();
    await jobs.forget(7);
    await expect(jobs.get(7)).resolves.toBeNull();
  });
});

describe('capture: the other AI sites', () => {
  it('sends a Midjourney result from its own image host', async () => {
    const deps = dependencies({
      fetchMedia: vi.fn(async () => media(undefined, 'image/webp')),
      hasAccess: vi.fn(async () => true),
    });
    const message = await sendCaptureToDesktop(
      {
        srcUrl: 'https://cdn.midjourney.com/abc/0_0.webp',
        pageUrl: 'https://www.midjourney.com/imagine',
        tabJob: null,
      },
      deps,
    );
    expect(message).toBe(CAPTURE_SENT_MESSAGE);
    expect(deps.hasAccess).toHaveBeenCalledWith([
      'https://cdn.midjourney.com/*',
    ]);
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({ site: 'midjourney', mime: 'image/webp' }),
    );
  });

  it('refuses media from another host, even on a supported page', async () => {
    const deps = dependencies();
    await expect(
      sendCaptureToDesktop(
        {
          srcUrl: 'https://tracker.example/pixel.png',
          pageUrl: 'https://www.midjourney.com/imagine',
          tabJob: null,
        },
        deps,
      ),
    ).resolves.toBe(CAPTURE_UNSUPPORTED_MESSAGE);
    expect(
      capturePatterns(
        'https://cdn.midjourney.com/a.png',
        'https://example.com/',
      ),
    ).toEqual([]);
    expect(
      capturePatterns(
        'http://cdn.midjourney.com/a.png',
        'https://www.midjourney.com/',
      ),
    ).toEqual([]);
    expect(deps.fetchMedia).not.toHaveBeenCalled();
  });

  it('says so when Chrome access to the site was not given', async () => {
    const deps = dependencies({ hasAccess: vi.fn(async () => false) });
    await expect(
      sendCaptureToDesktop(
        {
          srcUrl: 'https://s21-kling.klingai.com/v/clip.mp4',
          pageUrl: 'https://app.klingai.com/global/',
          tabJob: null,
        },
        deps,
      ),
    ).resolves.toBe(CAPTURE_NO_ACCESS_MESSAGE);
    expect(deps.fetchMedia).not.toHaveBeenCalled();
  });

  it('keeps redirects on the hosts of the same site', () => {
    const check = mediaUrlCheck(['https://*.klingai.com/*']);
    expect(check('https://v15-kling.klingai.com/x.mp4')).toBe(true);
    expect(check('https://example.com/x.mp4')).toBe(false);
    expect(check('not a url')).toBe(false);
  });
});
