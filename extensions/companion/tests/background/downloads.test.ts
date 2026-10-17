import { describe, expect, it } from 'vitest';

import {
  isSupportedDownloadUrl,
  sanitizeDownloadPath,
} from '../../src/background/downloads';

describe('download boundary helpers', () => {
  it('normalizes nested paths without allowing traversal', () => {
    expect(sanitizeDownloadPath('../Grok: Jobs/../../CON/video?.mp4')).toBe(
      'Grok_ Jobs/_CON/video_.mp4',
    );
  });

  it('returns a safe fallback for an unusable path', () => {
    expect(sanitizeDownloadPath('../..', 'result.jpg')).toBe('result.jpg');
  });

  it('allows only trusted generated-resource URLs', () => {
    expect(isSupportedDownloadUrl('https://assets.grok.com/video.mp4')).toBe(
      true,
    );
    expect(isSupportedDownloadUrl('https://vidgen.x.ai/video.mp4')).toBe(true);
    expect(isSupportedDownloadUrl('data:image/jpeg;base64,AA==')).toBe(true);
    expect(isSupportedDownloadUrl('blob:https://grok.com/example-id')).toBe(
      true,
    );
    expect(isSupportedDownloadUrl('http://grok.com/video.mp4')).toBe(false);
    expect(isSupportedDownloadUrl('https://grok.com.evil.test/video.mp4')).toBe(
      false,
    );
    expect(isSupportedDownloadUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(
      false,
    );
    expect(isSupportedDownloadUrl('blob:chrome-extension://example/id')).toBe(
      false,
    );
    expect(isSupportedDownloadUrl('javascript:alert(1)')).toBe(false);
    expect(isSupportedDownloadUrl('not a url')).toBe(false);
  });
});
