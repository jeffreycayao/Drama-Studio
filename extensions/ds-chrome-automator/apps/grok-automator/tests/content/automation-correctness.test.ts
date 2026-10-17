// @vitest-environment happy-dom

import archivedConfig from '../../src/config/remote-config.snapshot.json';
import {
  captureGeneratedArticleSnapshot,
  decodePreparedImage,
  findFreshGeneratedArticle,
  uploadAllImages,
  waitForGeneratedArticle,
} from '../../src/content/automation';
import {
  automationConfigSchema,
  type PromptPayload,
} from '../../src/protocol/content';
import { beforeEach, describe, expect, it } from 'vitest';

const baseConfig = automationConfigSchema.parse(archivedConfig);

function imagePayload(): PromptPayload {
  return {
    prompt: 'Create a portrait',
    promptIndex: 1,
    mode: 'imageToImage',
    aspectRatio: '1:1',
    outputCount: 1,
    folderName: 'results',
    imageModel: 'quality',
    autoDownloadResourceQuality: '1k',
    images: [
      { base64: 'data:image/png;base64,AA==', name: 'first.png' },
      { base64: 'data:image/webp;base64,AA==', name: 'second.webp' },
      { base64: 'data:image/jpeg;base64,AA==', name: 'third.jpg' },
    ],
  };
}

function articleConfig() {
  return {
    ...baseConfig,
    selectors: { ...baseConfig.selectors, mainArticle: 'article' },
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('prepared image decoding', () => {
  it('uses the data URL MIME type and preserves the supplied filename extension', () => {
    const file = decodePreparedImage({
      base64: 'data:image/png;base64,AA==',
      name: 'portrait.final.png',
    });

    expect(file.type).toBe('image/png');
    expect(file.name).toBe('portrait.final.png');
  });

  it('derives a matching extension when the prepared image has no filename', () => {
    const file = decodePreparedImage({
      base64: 'data:image/webp;base64,AA==',
    });

    expect(file.type).toBe('image/webp');
    expect(file.name).toMatch(/^image-\d+\.webp$/);
  });
});

describe('image upload aggregation', () => {
  it('fails the image configuration batch as soon as any supplied upload fails', async () => {
    const attemptedIndexes: number[] = [];
    const succeeded = await uploadAllImages(
      imagePayload(),
      baseConfig,
      () => false,
      async (_payload, imageIndex) => {
        attemptedIndexes.push(imageIndex);
        return imageIndex !== 1;
      },
    );

    expect(succeeded).toBe(false);
    expect(attemptedIndexes).toEqual([0, 1]);
  });
});

describe('generated article freshness', () => {
  it('does not accept an unchanged pre-existing article', () => {
    const article = document.createElement('article');
    article.innerHTML = '<p>Existing result</p>';
    document.body.append(article);
    const config = articleConfig();
    const snapshot = captureGeneratedArticleSnapshot(config);

    expect(findFreshGeneratedArticle(config, snapshot)).toBeNull();
  });

  it('recognizes a newly appended latest article and returns a local selector token', async () => {
    const oldArticle = document.createElement('article');
    oldArticle.innerHTML = '<p>Existing result</p>';
    document.body.append(oldArticle);
    const config = articleConfig();
    const snapshot = captureGeneratedArticleSnapshot(config);

    const newArticle = document.createElement('article');
    newArticle.innerHTML = '<p>New submission</p>';
    document.body.append(newArticle);

    const [selector] = await waitForGeneratedArticle(
      () => false,
      config,
      snapshot,
    );
    expect(selector).toBeDefined();
    expect(document.querySelector(selector!)).toBe(newArticle);
  });

  it('recognizes an existing latest article only after its submission content changes', () => {
    const article = document.createElement('article');
    article.innerHTML = '<p>Existing result</p>';
    document.body.append(article);
    const config = articleConfig();
    const snapshot = captureGeneratedArticleSnapshot(config);

    article.innerHTML = '<p>New submission is generating</p>';

    expect(findFreshGeneratedArticle(config, snapshot)).toBe(article);
  });
});
