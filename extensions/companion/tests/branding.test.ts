import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['entrypoints', 'src', 'public'];
const TEXT = /\.(?:ts|vue|css|html|json|md|txt)$/u;

/** Old product, owner and store names that must not ship. */
const LEGACY =
  /paks(?:\s|-)?tools|paks llc|grok automator|sellify|chris\.dev|sys0001x|faceless automations|bypass(?:es)? cloudfront/iu;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe('Drama Studio branding', () => {
  const shipped = SHIPPED.flatMap((folder) => files(path.join(ROOT, folder)))
    .filter((file) => TEXT.test(file))
    .filter((file) => !file.includes(`${path.sep}licenses${path.sep}`));

  it('ships none of the old product names', () => {
    const offenders = shipped.filter((file) =>
      LEGACY.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it('uses theme tokens instead of raw colours in the side panel', () => {
    const css = readFileSync(
      path.join(ROOT, 'src', 'sidepanel', 'styles.css'),
      'utf8',
    );
    expect(css.match(/#[0-9a-f]{3,8}\b/giu) ?? []).toEqual([]);
  });

  it('mirrors the desktop app’s lime accent and charcoal text on lime', () => {
    const tokens = readFileSync(
      path.join(ROOT, 'src', 'brand', 'tokens.css'),
      'utf8',
    );
    expect(tokens).toContain('--sf-accent: 213 250 0;');
    expect(tokens).toContain('--sf-on-accent: 30 27 21;');
    expect(tokens).toContain('--sf-dark-800: 39 35 27;');
    expect(tokens).toContain('--sf-text-primary: 246 241 230;');
    expect(tokens).toContain('--sf-accent-muted: 104 115 35;');
  });
});
