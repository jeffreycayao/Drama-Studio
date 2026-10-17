import {
  assertNoBoundaryViolations,
  findBoundaryViolations,
} from './lib/source-boundaries.mjs';

const violations = await findBoundaryViolations();
assertNoBoundaryViolations(violations);
process.stdout.write(
  'Verified active entrypoints and clean source do not import recovery trees.\n',
);
