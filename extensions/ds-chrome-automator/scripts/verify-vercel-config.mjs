import path from 'node:path';

import {
  assertRegularFile,
  verifyCanonicalConfigs,
} from './lib/vercel-release.mjs';
import {
  repositoryRoot,
  vercelOrgId,
  vercelSurfaces,
} from './lib/vercel-surfaces.mjs';

const results = await verifyCanonicalConfigs();
await assertRegularFile(path.join(repositoryRoot, 'api', 'index.ts'));

for (const result of results) {
  const surface = vercelSurfaces[result.surface];
  process.stdout.write(
    `${surface.id}: ${surface.canonicalConfig}, ${vercelOrgId}/${surface.projectId}, sha256 ${result.digest}\n`,
  );
}

process.stdout.write(
  'Verified canonical Vercel config drift policy. apps/faceless-platform-api/vercel.json is preserved as non-canonical historical workspace configuration and is never selected by root release commands.\n',
);
