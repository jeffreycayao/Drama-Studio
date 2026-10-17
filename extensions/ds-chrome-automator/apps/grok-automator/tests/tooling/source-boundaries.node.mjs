import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  containsForbiddenSourceMarker,
  extractModuleSpecifiers,
  findBoundaryViolations,
} from '../../scripts/lib/source-boundaries.mjs';

test('extracts static, dynamic, and CommonJS module references but not comments', () => {
  const source = `
    // import '../src/legacy/commented.js';
    import current from './current.js';
    export { helper } from './helper.js';
    const lazy = import('../src/recovered/lazy.js');
    const old = require('../forensics/archive.json');
  `;
  assert.deepEqual(extractModuleSpecifiers(source).sort(), [
    '../forensics/archive.json',
    '../src/recovered/lazy.js',
    './current.js',
    './helper.js',
  ]);
});

test('finds forbidden imports from entrypoints and clean source', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'boundary-gate-'));
  try {
    await Promise.all([
      mkdir(path.join(projectRoot, 'entrypoints'), { recursive: true }),
      mkdir(path.join(projectRoot, 'src', 'legacy'), { recursive: true }),
      mkdir(path.join(projectRoot, 'src', 'recovered'), { recursive: true }),
      mkdir(path.join(projectRoot, 'forensics'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(projectRoot, 'entrypoints', 'main.ts'),
        `import '../src/legacy/old.js';`,
      ),
      writeFile(
        path.join(projectRoot, 'src', 'config.ts'),
        `import config from '../forensics/config.json';`,
      ),
      writeFile(
        path.join(projectRoot, 'src', 'legacy', 'ignored.ts'),
        `import '../recovered/internal.js';`,
      ),
    ]);

    assert.deepEqual(await findBoundaryViolations({ projectRoot }), [
      { file: 'entrypoints/main.ts', specifier: '../src/legacy/old.js' },
      { file: 'src/config.ts', specifier: '../forensics/config.json' },
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('recognizes recovery source markers in generated text', () => {
  assert.equal(
    containsForbiddenSourceMarker('source: src/recovered/module.ts'),
    true,
  );
  assert.equal(
    containsForbiddenSourceMarker('source: src/current/module.ts'),
    false,
  );
});
