import path from 'node:path';

import { PROJECT_ROOT } from './lib/release-common.mjs';
import { assertNoFindings, scanPaths } from './lib/security-scanner.mjs';

const roots = [
  path.join(PROJECT_ROOT, 'entrypoints'),
  path.join(PROJECT_ROOT, 'src'),
  path.join(PROJECT_ROOT, 'public'),
];
const findings = await scanPaths(roots, { baseDirectory: PROJECT_ROOT });
assertNoFindings(findings, 'Development source security scan');
process.stdout.write(
  'Scanned active entrypoints, clean source, and public assets for secrets and remote executable code.\n',
);
