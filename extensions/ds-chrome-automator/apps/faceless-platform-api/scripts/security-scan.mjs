import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scannedRoots = ['api', 'src', 'scripts', 'db'];
const textExtensions = new Set(['.ts', '.mjs', '.sql', '.json']);
const failures = [];

const prohibited = [
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/gu, 'Stripe credential'],
  [/\bwhsec_[A-Za-z0-9]{20,}\b/gu, 'Stripe webhook credential'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu, 'private key'],
  [/Access-Control-Allow-Origin['"`\s:]+\*/gu, 'wildcard CORS'],
  [
    /(?:JSON\.stringify|Object\.(?:entries|keys|values)|console\.(?:log|dir|error))\s*\(\s*process\.env/gu,
    'environment dump',
  ],
  [/\b(?:admin|license|entitlement)Bypass\b/giu, 'authorization bypass'],
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (entry.isFile() && textExtensions.has(extname(entry.name)))
      files.push(path);
  }
  return files;
}

for (const directory of scannedRoots) {
  for (const path of await collect(join(root, directory))) {
    const contents = await readFile(path, 'utf8');
    for (const [pattern, label] of prohibited) {
      pattern.lastIndex = 0;
      if (pattern.test(contents)) {
        failures.push(`${relative(root, path)}: ${label}`);
      }
    }
  }
}

const rootEntries = await readdir(root);
for (const entry of rootEntries) {
  if (entry === '.env' || entry.startsWith('.env.')) {
    failures.push(`${entry}: local environment files are forbidden`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Platform API source security scan failed:\n${failures.join('\n')}`,
  );
}

process.stdout.write('Platform API source security scan passed.\n');
