import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(packageRoot, 'dist');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

const files = await listFiles(distRoot);
const toPortablePath = (file) =>
  relative(packageRoot, file).replaceAll('\\', '/');
const relativeFiles = files.map(toPortablePath);
const sourceMaps = relativeFiles.filter((file) => extname(file) === '.map');

if (sourceMaps.length > 0) {
  throw new Error(`Source maps are forbidden: ${sourceMaps.join(', ')}`);
}

for (const required of ['dist/index.js', 'dist/index.d.ts']) {
  if (!relativeFiles.includes(required)) {
    throw new Error(`Missing required build artifact: ${required}`);
  }
}

for (const file of files.filter((candidate) => candidate.endsWith('.js'))) {
  const source = await readFile(file, 'utf8');
  if (/sourceMappingURL=/u.test(source)) {
    throw new Error(`Source map reference found in ${toPortablePath(file)}`);
  }
}

const builtIndex = await readFile(join(distRoot, 'index.js'), 'utf8');
const builtAuth = await readFile(join(distRoot, 'auth.js'), 'utf8');
const builtUsage = await readFile(join(distRoot, 'usage.js'), 'utf8');
for (const [source, marker] of [
  [builtIndex, "export * from './auth.js'"],
  [builtAuth, 'createExtensionAuthFlowResponseV1Schema'],
  [builtAuth, 'csrfToken'],
  [builtUsage, 'usageReservationFinalizeRequestSchema'],
  [builtUsage, 'usageReservationRollbackRequestSchema'],
]) {
  if (!source.includes(marker)) {
    throw new Error(`Missing versioned contract artifact: ${marker}`);
  }
}

console.log(
  `[platform-contracts] verified ${relativeFiles.length} build files; no source maps`,
);
