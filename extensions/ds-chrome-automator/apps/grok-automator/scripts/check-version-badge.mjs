import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PROJECT_ROOT, readPackageMetadata } from './lib/release-common.mjs';
import {
  renderVersionBadge,
  VERSION_BADGE_RELATIVE_PATH,
} from './lib/version-badge.mjs';

const packageMetadata = await readPackageMetadata();
const badgeFile = path.join(
  PROJECT_ROOT,
  'public',
  VERSION_BADGE_RELATIVE_PATH,
);
const actualBadge = await readFile(badgeFile, 'utf8');
const expectedBadge = renderVersionBadge(packageMetadata.version);

if (actualBadge !== expectedBadge) {
  throw new Error(
    `Version badge is stale. Run npm run generate:version-badge --workspace=apps/grok-automator and commit ${badgeFile}`,
  );
}

console.log(`Version badge matches Grok Automator ${packageMetadata.version}.`);
