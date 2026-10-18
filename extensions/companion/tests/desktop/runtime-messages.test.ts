import { describe, expect, it } from 'vitest';

import {
  captureMediaResponseSchema,
  desktopRuntimeMessageSchema,
} from '../../src/desktop/messages';

describe('on-page capture message', () => {
  it('accepts one https file address', () => {
    expect(
      desktopRuntimeMessageSchema.safeParse({
        type: 'DESKTOP_CAPTURE_MEDIA',
        srcUrl: 'https://imgen.x.ai/xai-imgen/one.jpeg',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['http', 'http://imgen.x.ai/one.jpeg'],
    ['blob', 'blob:https://grok.com/0000'],
    ['data', 'data:image/png;base64,AAAA'],
    ['too long', `https://imgen.x.ai/${'a'.repeat(4100)}`],
  ])('refuses a %s address', (_label, srcUrl) => {
    expect(
      desktopRuntimeMessageSchema.safeParse({
        type: 'DESKTOP_CAPTURE_MEDIA',
        srcUrl,
      }).success,
    ).toBe(false);
  });

  it('refuses extra fields, such as a page address the page picked', () => {
    expect(
      desktopRuntimeMessageSchema.safeParse({
        type: 'DESKTOP_CAPTURE_MEDIA',
        srcUrl: 'https://imgen.x.ai/one.jpeg',
        pageUrl: 'https://grok.com/imagine',
      }).success,
    ).toBe(false);
  });

  it('answers with a short message for the person', () => {
    expect(
      captureMediaResponseSchema.safeParse({ ok: true, message: 'Sent.' })
        .success,
    ).toBe(true);
    expect(
      captureMediaResponseSchema.safeParse({ ok: true, message: '' }).success,
    ).toBe(false);
  });
});
