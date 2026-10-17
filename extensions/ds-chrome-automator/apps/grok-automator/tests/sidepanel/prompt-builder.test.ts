import { describe, expect, it } from 'vitest';

import {
  buildPromptPayloads,
  buildPromptPayloadsResult,
  parsePrompts,
} from '../../src/sidepanel/prompt-builder';
import { DEFAULT_SETTINGS } from '../../src/sidepanel/settings';
import type { AutomationMode, UploadedImage } from '../../src/sidepanel/types';

const image = (id: string, name: string): UploadedImage => ({
  id,
  name,
  base64: 'data:image/png;base64,AA==',
  uploadedAt: 1,
});

describe('prompt payload builder', () => {
  it('parses prompts on blank-line boundaries', () => {
    expect(parsePrompts(' first \n\n\n second\nline \n\n')).toEqual([
      'first',
      'second\nline',
    ]);
  });

  it.each<AutomationMode>([
    'textToVideo',
    'imageToVideo',
    'componentsToVideo',
    'textToImage',
    'imageToImage',
  ])('builds content-script-compatible payloads for %s', (mode) => {
    const payloads = buildPromptPayloads({
      mode,
      promptText: 'alpha\n\nbeta',
      images: [image('a', 'alpha.png'), image('b', 'beta.png')],
      settings: { ...DEFAULT_SETTINGS },
    });
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      mode,
      promptIndex: 1,
      aspectRatio: '16:9',
    });
  });

  it('supports per-prompt video overrides and strips concat from the final selected prompt', () => {
    const result = buildPromptPayloadsResult({
      mode: 'textToVideo',
      promptText: 'one\n\ntwo\n\nthree',
      images: [],
      settings: { ...DEFAULT_SETTINGS, concurrentPrompts: 4, outputCount: 3 },
      videoOption: '6s',
      optionOverrides: {
        1: '10s-concat',
        2: '15s',
        3: '6s-concat',
      },
    });

    expect(result.valid).toBe(true);
    expect(result.payloads.map((payload) => payload.videoOption)).toEqual([
      '10s-concat',
      '15s',
      '6s',
    ]);
    expect(result.payloads.map((payload) => payload.isConcat)).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.payloads[0]).toMatchObject({
      concurrentPrompts: 1,
      outputCount: 1,
    });
  });

  it('supports per-prompt image overrides and strips final image concat', () => {
    const result = buildPromptPayloadsResult({
      mode: 'textToImage',
      promptText: 'one\n\ntwo\n\nthree',
      images: [],
      settings: { ...DEFAULT_SETTINGS },
      imageOption: 'new-image',
      optionOverrides: {
        1: 'new-image-concat',
        3: 'new-image-concat',
      },
    });

    expect(result.valid).toBe(true);
    expect(result.payloads.map((payload) => payload.isConcat)).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.metadata.concatPromptIndices).toEqual([1]);
  });

  it('selects the range before dependency and image planning and preserves original indices', () => {
    const result = buildPromptPayloadsResult({
      mode: 'imageToVideo',
      promptText: 'omitted chain\n\nselected two\n\nselected three',
      images: [image('a', 'a.png'), image('b', 'b.png')],
      settings: {
        ...DEFAULT_SETTINGS,
        imageToVideoMaxImagesPerPrompt: 1,
      },
      optionOverrides: { 1: '6s-concat' },
      range: { start: 2, end: 3 },
    });

    expect(result.valid).toBe(true);
    expect(result.metadata.selectedPromptIndices).toEqual([2, 3]);
    expect(result.metadata.concatPromptIndices).toEqual([]);
    expect(result.payloads.map((payload) => payload.promptIndex)).toEqual([
      2, 3,
    ]);
    expect(
      result.payloads.map((payload) =>
        payload.images?.map((candidate) => candidate.id),
      ),
    ).toEqual([['a'], ['b']]);
  });

  it('uses sequential non-wrapping image-to-video assignment and zero images for max-one concat successors', () => {
    const result = buildPromptPayloadsResult({
      mode: 'imageToVideo',
      promptText: 'one\n\ntwo\n\nthree',
      images: [image('a', 'a.png'), image('b', 'b.png')],
      settings: {
        ...DEFAULT_SETTINGS,
        imageToVideoMaxImagesPerPrompt: 1,
      },
      optionOverrides: { 1: '6s-concat' },
    });

    expect(result.valid).toBe(true);
    expect(
      result.payloads.map((payload) =>
        payload.images?.map((candidate) => candidate.id),
      ),
    ).toEqual([['a'], [], ['b']]);
    expect(result.metadata.imageAssignments).toMatchObject([
      { promptIndex: 1, requiredImages: 1, assignedImages: 1 },
      { promptIndex: 2, requiredImages: 0, assignedImages: 0 },
      { promptIndex: 3, requiredImages: 1, assignedImages: 1 },
    ]);
  });

  it('uses one sequential image for max-greater-than-one concat successors', () => {
    const result = buildPromptPayloadsResult({
      mode: 'imageToVideo',
      promptText: 'one\n\ntwo\n\nthree',
      images: [
        image('a', 'a.png'),
        image('b', 'b.png'),
        image('c', 'c.png'),
        image('d', 'd.png'),
        image('e', 'e.png'),
      ],
      settings: {
        ...DEFAULT_SETTINGS,
        imageToVideoMaxImagesPerPrompt: 2,
      },
      optionOverrides: { 1: '10s-concat' },
    });

    expect(result.valid).toBe(true);
    expect(
      result.payloads.map((payload) =>
        payload.images?.map((candidate) => candidate.id),
      ),
    ).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
  });

  it('returns actionable image-to-video shortage metadata without wrapping', () => {
    const result = buildPromptPayloadsResult({
      mode: 'imageToVideo',
      promptText: 'one\n\ntwo',
      images: [image('a', 'a.png'), image('b', 'b.png'), image('c', 'c.png')],
      settings: {
        ...DEFAULT_SETTINGS,
        imageToVideoMaxImagesPerPrompt: 2,
      },
    });

    expect(result.valid).toBe(false);
    expect(
      result.payloads[1]?.images?.map((candidate) => candidate.id),
    ).toEqual(['c']);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'INSUFFICIENT_IMAGES',
        promptIndex: 2,
        requiredImages: 2,
        availableImages: 1,
      }),
    );
    expect(result.metadata).toMatchObject({
      requiredImageCount: 4,
      assignedImageCount: 3,
    });
    expect(() =>
      buildPromptPayloads({
        mode: 'imageToVideo',
        promptText: 'one\n\ntwo',
        images: [image('a', 'a.png')],
        settings: {
          ...DEFAULT_SETTINGS,
          imageToVideoMaxImagesPerPrompt: 1,
        },
      }),
    ).toThrow(/never wrapped/i);
  });

  it('cycles reusable component images across prompts', () => {
    const result = buildPromptPayloadsResult({
      mode: 'componentsToVideo',
      promptText: 'one\n\ntwo\n\nthree',
      images: [image('a', 'a.png'), image('b', 'b.png'), image('c', 'c.png')],
      settings: {
        ...DEFAULT_SETTINGS,
        componentsToVideoMaxImagesPerPrompt: 2,
        autoAddCharacterImages: false,
      },
    });

    expect(result.valid).toBe(true);
    expect(
      result.payloads.map((payload) =>
        payload.images?.map((candidate) => candidate.id),
      ),
    ).toEqual([
      ['a', 'b'],
      ['c', 'a'],
      ['b', 'c'],
    ]);
  });

  it('assigns zero component images to a concat successor without reporting an error', () => {
    const result = buildPromptPayloadsResult({
      mode: 'componentsToVideo',
      promptText: 'one\n\ntwo\n\nthree',
      images: [image('a', 'a.png'), image('b', 'b.png')],
      settings: {
        ...DEFAULT_SETTINGS,
        componentsToVideoMaxImagesPerPrompt: 1,
      },
      optionOverrides: { 1: '6s-concat' },
    });

    expect(result.valid).toBe(true);
    expect(
      result.payloads.map((payload) =>
        payload.images?.map((candidate) => candidate.id),
      ),
    ).toEqual([['a'], [], ['b']]);
    expect(result.metadata.imageAssignments[1]).toMatchObject({
      promptIndex: 2,
      requiredImages: 0,
      assignedImages: 0,
    });
    expect(result.errors).toEqual([]);
  });

  it('matches reusable component images by filename when enabled', () => {
    const result = buildPromptPayloadsResult({
      mode: 'componentsToVideo',
      promptText: 'Alice enters\n\nBob waves',
      images: [image('alice', 'Alice.png'), image('bob', 'Bob.jpg')],
      settings: { ...DEFAULT_SETTINGS, autoAddCharacterImages: true },
    });

    expect(result.valid).toBe(true);
    expect(
      result.payloads[0]?.images?.map((candidate) => candidate.id),
    ).toEqual(['alice']);
    expect(
      result.payloads[1]?.images?.map((candidate) => candidate.id),
    ).toEqual(['bob']);
  });

  it('assigns zero image-to-image uploads to a concat successor', () => {
    const result = buildPromptPayloadsResult({
      mode: 'imageToImage',
      promptText: 'one\n\ntwo',
      images: [image('a', 'a.png'), image('b', 'b.png')],
      settings: {
        ...DEFAULT_SETTINGS,
        imageToImageMaxImagesPerPrompt: 1,
      },
      imageOption: 'new-image-concat',
    });

    expect(result.valid).toBe(true);
    expect(result.payloads.map((payload) => payload.isConcat)).toEqual([
      true,
      false,
    ]);
    expect(
      result.payloads.map((payload) =>
        payload.images?.map((candidate) => candidate.id),
      ),
    ).toEqual([['a'], []]);
    expect(result.metadata.imageAssignments[1]).toMatchObject({
      promptIndex: 2,
      strategy: 'cycle',
      requiredImages: 0,
      assignedImages: 0,
    });
    expect(result.errors).toEqual([]);
  });

  it('returns clear validation errors for empty input, ranges, overrides, and filename misses', () => {
    const empty = buildPromptPayloadsResult({
      mode: 'textToVideo',
      promptText: '  ',
      images: [],
      settings: { ...DEFAULT_SETTINGS },
    });
    expect(empty.errors).toMatchObject([{ code: 'NO_PROMPTS' }]);

    const invalidRange = buildPromptPayloadsResult({
      mode: 'textToVideo',
      promptText: 'one\n\ntwo',
      images: [],
      settings: { ...DEFAULT_SETTINGS },
      range: { start: 2, end: 1 },
    });
    expect(invalidRange.errors).toMatchObject([{ code: 'INVALID_RANGE' }]);

    const invalidOverride = buildPromptPayloadsResult({
      mode: 'textToVideo',
      promptText: 'one',
      images: [],
      settings: { ...DEFAULT_SETTINGS },
      optionOverrides: { 1: 'new-image' },
    });
    expect(invalidOverride.errors).toMatchObject([
      { code: 'INVALID_OPTION_OVERRIDE', promptIndex: 1 },
    ]);

    const filenameMiss = buildPromptPayloadsResult({
      mode: 'imageToImage',
      promptText: 'No named character',
      images: [image('alice', 'Alice.png')],
      settings: { ...DEFAULT_SETTINGS, autoAddCharacterImages: true },
    });
    expect(filenameMiss.errors).toMatchObject([
      { code: 'NO_MATCHING_IMAGES', promptIndex: 1 },
    ]);
  });
});
