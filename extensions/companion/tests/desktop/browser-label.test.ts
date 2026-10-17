import { describe, expect, it } from 'vitest';

import { browserLabel } from '../../src/desktop/browser-label';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_UA = `${CHROME_UA} Edg/141.0.0.0`;

describe('browserLabel', () => {
  it('prefers the user-agent brands', () => {
    expect(
      browserLabel({
        userAgent: EDGE_UA,
        userAgentData: {
          brands: [
            { brand: 'Not?A_Brand', version: '99' },
            { brand: 'Chromium', version: '141' },
            { brand: 'Microsoft Edge', version: '141' },
          ],
        },
      }),
    ).toBe('Edge 141');
    expect(
      browserLabel({
        userAgent: CHROME_UA,
        userAgentData: {
          brands: [
            { brand: 'Chromium', version: '141' },
            { brand: 'Google Chrome', version: '141' },
          ],
        },
      }),
    ).toBe('Chrome 141');
  });

  it('falls back to the user-agent string', () => {
    expect(browserLabel({ userAgent: EDGE_UA })).toBe('Edge 141');
    expect(browserLabel({ userAgent: CHROME_UA })).toBe('Chrome 141');
    expect(browserLabel({ userAgent: 'Something else' })).toBe('Browser');
  });

  it('always fits the 64-character wire limit', () => {
    expect(browserLabel({ userAgent: CHROME_UA }).length).toBeLessThanOrEqual(
      64,
    );
    expect(
      browserLabel({
        userAgent: '',
        userAgentData: {
          brands: [{ brand: 'Chromium', version: '9'.repeat(200) }],
        },
      }).length,
    ).toBeLessThanOrEqual(64);
  });
});
