import { describe, expect, it } from 'vitest';

import { resolvePlanLabel } from '../../src/sidepanel/plan-display';

describe('plan display labels', () => {
  it.each([
    ['free-plan', false, 'Free plan'],
    ['single-license', true, 'Grok Automator™ license'],
    ['all-apps', true, 'All Apps license'],
    ['future-paid-plan', true, 'Active license'],
    ['future-free-plan', false, 'Free plan'],
  ] as const)('maps %s with pro=%s to %s', (planCode, pro, expected) => {
    expect(resolvePlanLabel(planCode, pro)).toBe(expected);
  });
});
