import { describe, expect, it } from 'vitest';

import { isGrokPage } from '../../src/content/page';

describe('content page boundary', () => {
  it('accepts HTTPS Grok pages and rejects insecure or lookalike origins', () => {
    expect(isGrokPage('https://grok.com/imagine')).toBe(true);
    expect(isGrokPage('https://accounts.grok.com/path')).toBe(true);
    expect(isGrokPage('http://grok.com/imagine')).toBe(false);
    expect(isGrokPage('https://grok.com.evil.test/imagine')).toBe(false);
    expect(isGrokPage('https://grok.com:8443/imagine')).toBe(false);
  });
});
