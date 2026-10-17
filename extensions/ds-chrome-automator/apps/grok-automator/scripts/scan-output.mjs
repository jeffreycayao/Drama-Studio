import { OUTPUT_ROOT, PROJECT_ROOT } from './lib/release-common.mjs';
import { assertNoFindings, scanPaths } from './lib/security-scanner.mjs';

const findings = await scanPaths([OUTPUT_ROOT], {
  baseDirectory: PROJECT_ROOT,
});
assertNoFindings(findings, 'Production output security scan');
process.stdout.write(
  'Scanned production output for secrets and remote executable code.\n',
);
