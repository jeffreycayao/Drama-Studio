import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = await readFile(resolve(root, 'src/fonts.css'), 'utf8');
const tokens = await readFile(resolve(root, 'src/tokens.css'), 'utf8');
const notice = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');

for (const family of ['Instrument Serif', 'Manrope', 'IBM Plex Mono']) {
  const familyPattern = new RegExp(
    `font-family:\\s*[\"']${family.replaceAll(' ', '\\s+')}[\"']`,
  );
  if (!familyPattern.test(fonts) || !tokens.includes(family)) {
    throw new Error(`Missing local font contract for ${family}`);
  }
}

if (/https?:\/\//i.test(fonts)) {
  throw new Error('Remote font URLs are forbidden.');
}

if (
  /\.woff(?:[\"')])/i.test(fonts) ||
  (fonts.match(/\.woff2/g) ?? []).length !== 8
) {
  throw new Error(
    'Typography must reference exactly eight WOFF2 files and no legacy WOFF files.',
  );
}

if (!notice.includes('SIL Open Font License, Version 1.1')) {
  throw new Error('Bundled-font license notice is incomplete.');
}

console.log('Brand typography and local-font policy verified.');
