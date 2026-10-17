// @vitest-environment happy-dom

import { grokAdapter as archivedConfig } from '../../src/sites/grok';
import {
  downloadFromElementIds,
  downloadImages,
} from '../../src/content/downloads';
import {
  automationConfigSchema,
  type PromptPayload,
} from '../../src/protocol/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config = automationConfigSchema.parse(archivedConfig);

function payload(): PromptPayload {
  return {
    prompt: 'A cinematic still',
    promptIndex: 1,
    mode: 'textToImage',
    aspectRatio: '16:9',
    outputCount: 2,
    folderName: 'results',
    imageModel: 'quality',
    autoDownloadResourceQuality: '1k',
  };
}

const sendMessage = vi.fn();

beforeEach(() => {
  sendMessage.mockReset();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function makeVisible(element: HTMLElement): void {
  element.getBoundingClientRect = () =>
    ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('generated resource downloads', () => {
  it('aggregates browser download failures and rejects the requested image batch', async () => {
    sendMessage.mockResolvedValue({ success: false, error: 'Download denied' });
    const first = document.createElement('img');
    first.src = 'https://imgen.x.ai/first.png';
    const second = document.createElement('img');
    second.src = 'https://imgen.x.ai/second.png';

    await expect(
      downloadImages([first, second], payload(), 'results', () => false),
    ).rejects.toThrow('Failed to download 2 of 2 requested resources');
    expect(
      sendMessage.mock.calls.filter(
        ([message]) => message?.type === 'DOWNLOAD_RESOURCE',
      ),
    ).toHaveLength(2);
  });

  it('does not expose a retry index when browser cancellation is ambiguous', async () => {
    sendMessage.mockResolvedValue({
      success: false,
      error: 'Download cancellation could not be confirmed',
      retryable: false,
    });
    const first = document.createElement('img');
    first.src = 'https://imgen.x.ai/ambiguous.png';
    const second = document.createElement('img');
    second.src = 'https://imgen.x.ai/must-not-start.png';

    const error = await downloadImages(
      [first, second],
      payload(),
      'results',
      () => false,
    ).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toMatchObject({ failedResourceIndexes: [0] });
    expect(
      sendMessage.mock.calls.filter(
        ([message]) => message?.type === 'DOWNLOAD_RESOURCE',
      ),
    ).toHaveLength(1);
  });

  it('retries only failed resource indexes and never repeats completed downloads', async () => {
    let downloadAttempt = 0;
    sendMessage.mockImplementation(async (message: { type?: string }) => {
      if (message.type !== 'DOWNLOAD_RESOURCE') return undefined;
      downloadAttempt += 1;
      return downloadAttempt === 2
        ? { success: false, error: 'Download denied' }
        : { success: true };
    });
    const first = document.createElement('img');
    first.src = 'https://imgen.x.ai/first.png';
    const second = document.createElement('img');
    second.src = 'https://imgen.x.ai/second.png';

    await expect(
      downloadImages([first, second], payload(), 'results', () => false),
    ).rejects.toMatchObject({ failedResourceIndexes: [1] });
    await expect(
      downloadImages([first, second], payload(), 'results', () => false, [1]),
    ).resolves.toBeUndefined();

    const downloadMessages = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === 'DOWNLOAD_RESOURCE');
    expect(downloadMessages).toHaveLength(3);
    expect(
      downloadMessages.filter((message) => message.url.endsWith('first.png')),
    ).toHaveLength(1);
    expect(
      downloadMessages.filter((message) => message.url.endsWith('second.png')),
    ).toHaveLength(2);
  });

  it('treats every unsupported generated resource URL as a failed request', async () => {
    const image = document.createElement('img');
    image.src = 'https://attacker.test/not-a-grok-result.png';

    await expect(
      downloadImages([image], payload(), 'results', () => false),
    ).rejects.toThrow('resource 1 has an unsupported URL');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('fails before DOM polling when no generated article identifier is supplied', async () => {
    await expect(
      downloadFromElementIds([], payload(), () => false, config),
    ).resolves.toEqual({
      success: false,
      error: 'No generated article identifier',
    });
  });

  it('downloads image-to-image output directly without clicking generation UI', async () => {
    sendMessage.mockResolvedValue({ success: true });
    const article = document.createElement('article');
    article.dataset.result = 'image';
    makeVisible(article);
    const grid = document.createElement('div');
    grid.className = 'grid';
    const image = document.createElement('img');
    image.src = 'https://imgen.x.ai/result.png';
    grid.append(image);
    article.append(grid);
    const generate = document.createElement('button');
    generate.dataset.generate = 'true';
    const generateClick = vi.fn();
    generate.addEventListener('click', generateClick);
    document.body.append(article, generate);
    const imagePayload: PromptPayload = {
      ...payload(),
      mode: 'imageToImage',
      outputCount: 1,
    };

    const result = await downloadFromElementIds(
      ['[data-result="image"]'],
      imagePayload,
      () => false,
      {
        ...config,
        selectors: {
          ...config.selectors,
          generateVideoButton: '[data-generate="true"]',
        },
      },
    );

    expect(result).toMatchObject({
      success: true,
      resourceDescriptors: [
        { kind: 'image', source: 'https://imgen.x.ai/result.png' },
      ],
    });
    expect(generateClick).not.toHaveBeenCalled();
    expect(
      sendMessage.mock.calls.some(
        ([message]) =>
          message?.type === 'DOWNLOAD_RESOURCE' &&
          message.url === 'https://imgen.x.ai/result.png',
      ),
    ).toBe(true);
  });

  it('downloads video output directly without clicking Generate when the stable resource already exists', async () => {
    sendMessage.mockResolvedValue({ success: true });
    const article = document.createElement('article');
    article.dataset.result = 'video';
    makeVisible(article);
    const video = document.createElement('video');
    video.src = 'https://vidgen.x.ai/result.mp4';
    article.append(video);
    const generate = document.createElement('button');
    generate.dataset.generate = 'true';
    const generateClick = vi.fn();
    generate.addEventListener('click', generateClick);
    document.body.append(article, generate);
    const videoPayload: PromptPayload = {
      ...payload(),
      mode: 'textToVideo',
      outputCount: 1,
      videoOption: '6s',
      autoDownloadResourceQuality: '480p',
    };

    const result = await downloadFromElementIds(
      ['[data-result="video"]'],
      videoPayload,
      () => false,
      {
        ...config,
        selectors: {
          ...config.selectors,
          generateVideoButton: '[data-generate="true"]',
        },
      },
    );

    expect(result).toMatchObject({
      success: true,
      resourceDescriptors: [
        { kind: 'video', source: 'https://vidgen.x.ai/result.mp4' },
      ],
    });
    expect(generateClick).not.toHaveBeenCalled();
  });

  it.each([
    {
      mode: 'imageToImage' as const,
      tag: 'img' as const,
      initial: 'https://imgen.x.ai/stable.png',
      replacement: 'https://imgen.x.ai/replacement.png',
    },
    {
      mode: 'textToVideo' as const,
      tag: 'video' as const,
      initial: 'https://vidgen.x.ai/stable.mp4',
      replacement: 'https://vidgen.x.ai/replacement.mp4',
    },
  ])(
    'retries $mode from its first stable resource identity with zero Generate clicks',
    async ({ mode, tag, initial, replacement }) => {
      let downloadAttempt = 0;
      sendMessage.mockImplementation(
        async (message: { type?: string; url?: string }) => {
          if (message.type !== 'DOWNLOAD_RESOURCE') return { success: true };
          downloadAttempt += 1;
          return downloadAttempt === 1
            ? { success: false, error: 'Download denied' }
            : { success: true };
        },
      );
      const article = document.createElement('article');
      article.dataset.result = mode;
      makeVisible(article);
      const grid = document.createElement('div');
      grid.className = 'grid';
      const resource = document.createElement(tag);
      resource.src = initial;
      if (tag === 'img') grid.append(resource);
      article.append(tag === 'img' ? grid : resource);
      const generate = document.createElement('button');
      generate.dataset.generate = 'true';
      const generateClick = vi.fn();
      generate.addEventListener('click', generateClick);
      document.body.append(article, generate);
      const modePayload: PromptPayload = {
        ...payload(),
        mode,
        outputCount: 1,
        ...(mode.includes('Video')
          ? { videoOption: '6s', autoDownloadResourceQuality: '480p' }
          : {}),
      };
      const modeConfig = {
        ...config,
        selectors: {
          ...config.selectors,
          generateVideoButton: '[data-generate="true"]',
        },
      };

      const first = await downloadFromElementIds(
        [`[data-result="${mode}"]`],
        modePayload,
        () => false,
        modeConfig,
      );
      expect(first).toMatchObject({
        success: false,
        failedResourceIndexes: [0],
        resourceDescriptors: [{ source: initial }],
      });

      resource.src = replacement;
      const retry = await downloadFromElementIds(
        [`[data-result="${mode}"]`],
        modePayload,
        () => false,
        modeConfig,
        first.failedResourceIndexes,
        first.resourceDescriptors,
      );

      expect(retry.success).toBe(true);
      expect(generateClick).not.toHaveBeenCalled();
      const urls = sendMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === 'DOWNLOAD_RESOURCE')
        .map((message) => message.url);
      expect(urls).toEqual([initial, initial]);
    },
  );

  it('skips video upscale and menu controls when retry descriptors are already persisted', async () => {
    sendMessage.mockResolvedValue({ success: true });
    const selectors = {
      ...config.selectors,
      generateVideoButton: '[data-generate="true"]',
      moreOptionsButton: '[data-more="true"]',
      upscaleMenuItem: '[data-upscale="true"]',
      upscale720pOption: '[data-720="true"]',
    };
    const controls = ['generate', 'more', 'upscale', '720'].map((name) => {
      const control = document.createElement('button');
      control.dataset[name] = 'true';
      document.body.append(control);
      return control;
    });
    const clicks = controls.map(() => vi.fn());
    controls.forEach((control, index) =>
      control.addEventListener('click', clicks[index]!),
    );

    const result = await downloadFromElementIds(
      ['[data-result="missing"]'],
      {
        ...payload(),
        mode: 'textToVideo',
        outputCount: 1,
        videoOption: '6s',
        autoDownloadResourceQuality: '720p',
      },
      () => false,
      { ...config, selectors },
      [0],
      [{ kind: 'video', source: 'https://vidgen.x.ai/stable-720.mp4' }],
    );

    expect(result.success).toBe(true);
    for (const click of clicks) expect(click).not.toHaveBeenCalled();
  });
});
