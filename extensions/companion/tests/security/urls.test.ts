import { describe, expect, it } from 'vitest';

import {
  isAllowedGeneratedHttpsUrl,
  isAllowedGeneratedResourceUrl,
  isBoundedBase64RasterDataUrl,
  isHttpsGrokUrl,
} from '../../src/security/urls';

describe('trusted URL policy', () => {
  it('accepts only HTTPS Grok hosts for page trust decisions', () => {
    expect(isHttpsGrokUrl('https://grok.com/imagine')).toBe(true);
    expect(isHttpsGrokUrl('https://accounts.grok.com/path')).toBe(true);
    expect(isHttpsGrokUrl('http://grok.com/imagine')).toBe(false);
    expect(isHttpsGrokUrl('https://grok.com.evil.test/imagine')).toBe(false);
    expect(isHttpsGrokUrl('https://notgrok.com/imagine')).toBe(false);
    expect(isHttpsGrokUrl('https://user@grok.com/imagine')).toBe(false);
    expect(isHttpsGrokUrl('https://grok.com:8443/imagine')).toBe(false);
  });

  it('allows only the documented HTTPS generated-media origins', () => {
    expect(
      isAllowedGeneratedHttpsUrl('https://assets.grok.com/result/video.mp4'),
    ).toBe(true);
    expect(
      isAllowedGeneratedHttpsUrl('https://imgen.x.ai/result/image.png'),
    ).toBe(true);
    expect(
      isAllowedGeneratedHttpsUrl('https://vidgen.x.ai/result/video.mp4'),
    ).toBe(true);
    expect(
      isAllowedGeneratedHttpsUrl('https://cdn.imgen.x.ai/result/image.png'),
    ).toBe(false);
    expect(
      isAllowedGeneratedHttpsUrl('https://other.x.ai/result/video.mp4'),
    ).toBe(false);
  });

  it('accepts bounded base64 raster data URLs but not active image formats', () => {
    expect(isBoundedBase64RasterDataUrl('data:image/png;base64,AA==', 1)).toBe(
      true,
    );
    expect(isBoundedBase64RasterDataUrl('data:image/jpeg;base64,AAAA', 2)).toBe(
      false,
    );
    expect(
      isBoundedBase64RasterDataUrl(
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      ),
    ).toBe(false);
    expect(isBoundedBase64RasterDataUrl('data:image/png,not-base64')).toBe(
      false,
    );
  });

  it('accepts blob URLs only when their embedded origin is allowlisted', () => {
    expect(
      isAllowedGeneratedResourceUrl('blob:https://grok.com/resource-id'),
    ).toBe(true);
    expect(
      isAllowedGeneratedResourceUrl('blob:https://imgen.x.ai/resource-id'),
    ).toBe(true);
    expect(
      isAllowedGeneratedResourceUrl('blob:https://grok.com.evil.test/id'),
    ).toBe(false);
    expect(isAllowedGeneratedResourceUrl('blob:null/resource-id')).toBe(false);
    expect(
      isAllowedGeneratedResourceUrl('blob:chrome-extension://extension/id'),
    ).toBe(false);
  });
});
