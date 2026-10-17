import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import { extractModuleSpecifiers } from '../../scripts/lib/source-boundaries.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const runtimeRoots = [
  path.join(projectRoot, 'entrypoints'),
  path.join(projectRoot, 'src'),
];
const runtimeSourcePattern = /\.(?:js|mjs|ts|vue)$/u;

async function walkRuntimeSource(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkRuntimeSource(target)));
    } else if (runtimeSourcePattern.test(entry.name)) {
      files.push(target);
    }
  }

  return files;
}

function isNonMiniZodSpecifier(specifier) {
  return (
    (specifier === 'zod' || specifier.startsWith('zod/')) &&
    specifier !== 'zod/mini'
  );
}

test('allows only the browser-safe Zod Mini runtime in extension source', async () => {
  const violations = [];

  for (const root of runtimeRoots) {
    for (const file of await walkRuntimeSource(root)) {
      const source = await readFile(file, 'utf8');
      for (const specifier of extractModuleSpecifiers(source)) {
        if (isNonMiniZodSpecifier(specifier)) {
          violations.push({
            file: path.relative(projectRoot, file).replaceAll('\\', '/'),
            specifier,
          });
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});
