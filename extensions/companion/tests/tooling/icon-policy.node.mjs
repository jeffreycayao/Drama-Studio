import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sidepanelRoot = path.join(projectRoot, 'src', 'sidepanel');
const forbiddenIconLibraryPattern =
  /(?:@lucide\/vue|@phosphor-icons\/vue|@heroicons\/vue|@iconify\/vue|primeicons|fontawesome)/iu;
const expectedTablerLicenseHash =
  'b740a1d46122672da62833e97f7e7c8a13fa85cbc7445b584b297cc00dde93db';

async function walkSource(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkSource(target)));
    else if (/\.(?:ts|vue)$/u.test(entry.name)) files.push(target);
  }
  return files;
}

test('pins Tabler as the only general-purpose side-panel icon library', async () => {
  const packageMetadata = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  );
  assert.equal(packageMetadata.dependencies?.['@tabler/icons-vue'], '3.46.0');
  assert.equal(packageMetadata.dependencies?.['@lucide/vue'], undefined);

  for (const file of await walkSource(sidepanelRoot)) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, forbiddenIconLibraryPattern, file);
    assert.doesNotMatch(
      source,
      /import\s*\(\s*['"]@tabler\/icons-vue['"]\s*\)/u,
      `${file} must not dynamically import Tabler`,
    );
    assert.doesNotMatch(
      source,
      /import\s+(?:\*\s+as|[A-Za-z_$][\w$]*)\s+from\s+['"]@tabler\/icons-vue['"]/u,
      `${file} must use static named Tabler imports`,
    );
    assert.doesNotMatch(
      source,
      /<svg(?:\s|>)/iu,
      `${file} must use reviewed Tabler components instead of hand-drawn SVG`,
    );
  }
});

test('ships the exact Tabler MIT notice with the extension', async () => {
  const notice = await readFile(
    path.join(projectRoot, 'public', 'THIRD_PARTY_NOTICES.md'),
    'utf8',
  );
  const license = await readFile(
    path.join(projectRoot, 'public', 'licenses', 'TABLER-LICENSE.txt'),
    'utf8',
  );

  assert.match(notice, /@tabler\/icons-vue` 3\.46\.0/u);
  assert.doesNotMatch(notice, /Lucide/iu);
  assert.equal(
    createHash('sha256').update(license).digest('hex'),
    expectedTablerLicenseHash,
  );
});
