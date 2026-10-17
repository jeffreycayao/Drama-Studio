import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PROJECT_ROOT, readPackageMetadata } from './lib/release-common.mjs';
import {
  renderVersionBadge,
  VERSION_BADGE_RELATIVE_PATH,
} from './lib/version-badge.mjs';

const packageMetadata = await readPackageMetadata();
const outputFile = path.join(
  PROJECT_ROOT,
  'public',
  VERSION_BADGE_RELATIVE_PATH,
);

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(
  outputFile,
  renderVersionBadge(packageMetadata.version),
  'utf8',
);
console.log(
  `Generated local Shields version badge for ${packageMetadata.version}: ${outputFile}`,
);
