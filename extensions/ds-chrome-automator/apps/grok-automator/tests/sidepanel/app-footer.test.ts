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

  it('uses the packaged Shields badge and exact legal stamp', () => {
    expect(footerSource).toContain("'/badges/version.svg'");
    expect(footerSource).toContain('© 2026 PAKS LLC. ALL RIGHTS RESERVED.');
    expect(footerSource).toContain('Grok Automator™ version ${version}');
    expect(footerSource).not.toMatch(/https?:\/\//u);
    expect(footerSource).not.toContain('img.shields.io');
  });
});
