import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  new URL('../../src/sidepanel/App.vue', import.meta.url),
  'utf8',
);
const footerSource = readFileSync(
  new URL('../../src/sidepanel/components/AppFooter.vue', import.meta.url),
  'utf8',
);

describe('shared application footer', () => {
  it('renders exactly once outside the tab-specific content', () => {
    expect(appSource.match(/<AppFooter\b/gu)).toHaveLength(1);
    expect(appSource).toContain('<AppFooter :version="version" />');
    expect(appSource.indexOf('<AppFooter')).toBeGreaterThan(
      appSource.indexOf('<DebugPanel'),
    );
    expect(appSource.indexOf('<AppFooter')).toBeLessThan(
      appSource.indexOf('<TipBeforeUseModal'),
    );
  });

  it('credits Drama Studio and loads nothing remote', () => {
    expect(footerSource).toContain('Drama Studio');
    expect(footerSource).not.toMatch(/https?:\/\//u);
    expect(footerSource).not.toMatch(/paks|grok automator/iu);
  });
});
