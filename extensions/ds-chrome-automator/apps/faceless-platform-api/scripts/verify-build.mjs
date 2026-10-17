import { access, readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

await access(join(dist, 'api/index.js'));
await access(join(dist, 'src/http/app.js'));
await access(join(dist, 'src/adapters/neon.js'));
await access(join(dist, 'src/adapters/stripe.js'));
await access(join(dist, 'src/adapters/migrations.js'));
await access(join(dist, 'src/http/node-request.js'));
await access(join(dist, 'src/http/rate-limit.js'));
await access(join(dist, 'src/core/compatibility.js'));

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else files.push(path);
  }
  return files;
}

const files = await collect(dist);
if (files.some((file) => extname(file) === '.map')) {
  throw new Error('Source maps must not be emitted by the platform API build');
}
if (files.some((file) => file.includes('.env'))) {
  throw new Error(
    'Environment files must not be emitted by the platform API build',
  );
}
const emittedApp = await readFile(join(dist, 'src/http/app.js'), 'utf8');
for (const route of [
  '/health/ready',
  '/v1/internal/migrations',
  '/v1/auth/extension-flows',
  'extensionVerifyRoute',
  'usageReservationRoute',
  'usageReservationTransitionRoute',
  'finalize|rollback',
  '/v1/admin/session',
  '/v1/admin/platform-settings',
  '/v1/webhooks/stripe',
]) {
  if (!emittedApp.includes(route))
    throw new Error(`Built API is missing ${route}`);
}

const emittedCompatibility = await readFile(
  join(dist, 'src/core/compatibility.js'),
  'utf8',
);
if (
  !emittedCompatibility.includes(
    "LEGACY_PROTOCOL_SUNSET_AT = '2026-11-30T00:00:00.000Z'",
  )
) {
  throw new Error('Built API has an unexpected legacy protocol sunset');
}

process.stdout.write(
  `Platform API build verified (${files.length} emitted files).\n`,
);
