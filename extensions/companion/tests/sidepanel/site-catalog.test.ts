import { describe, expect, it } from 'vitest';

import { AI_SITES } from '../../src/sites/ai-sites';
import { SITE_CATALOG, kindsLabel } from '../../src/sidepanel/site-catalog';

describe('Sites tab catalog', () => {
  it('lists every supported site, not only Grok', () => {
    expect(SITE_CATALOG.map((entry) => entry.id)).toEqual(
      AI_SITES.map((site) => site.id),
    );
    expect(SITE_CATALOG.length).toBeGreaterThanOrEqual(13);
  });

  it('says how each result comes back', () => {
    const grok = SITE_CATALOG.find((entry) => entry.id === 'grok-imagine');
    const flow = SITE_CATALOG.find((entry) => entry.id === 'google-flow');
    expect(grok?.sendBack).toBe('button');
    expect(grok?.features).toContain('Sets the shape for you');
    expect(flow?.sendBack).toBe('right-click');
  });

  it('describes Suno as a song site', () => {
    const suno = SITE_CATALOG.find((entry) => entry.id === 'suno');
    expect(kindsLabel(suno?.kinds ?? [])).toBe('Songs');
    expect(suno?.features).toContain('Fills style, lyrics and title');
    expect(suno?.features).not.toContain('Adds your reference files');
  });

  it('only opens https pages', () => {
    for (const entry of SITE_CATALOG)
      expect(entry.url.startsWith('https://')).toBe(true);
  });
});
