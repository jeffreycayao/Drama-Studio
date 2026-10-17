import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const bannerSource = readFileSync(
  new URL('../../src/sidepanel/components/PlanBanner.vue', import.meta.url),
  'utf8',
);

describe('connected account banner presentation', () => {
  it('shows verified account details and a connected state after sign-in', () => {
    expect(bannerSource).toContain('v-else-if="signedIn"');
    expect(bannerSource).toContain('class="plan-banner__connected"');
    expect(bannerSource).toContain('v-if="signedIn"');
    expect(bannerSource).toContain('class="plan-banner__account"');
    expect(bannerSource).toContain('{{ accountPrimary }}');
    expect(bannerSource).toContain('{{ accountSecondary }}');
  });

  it('keeps every sign-in action out of the connected account state', () => {
    const signInActions = [...bannerSource.matchAll(/Sign in/gu)];
    expect(signInActions).toHaveLength(2);
    expect(bannerSource).toContain(
      'v-if="!signedIn"\n        class="plan-banner__upgrade"',
    );
    expect(bannerSource).toContain(
      'v-else\n        class="plan-banner__signin"',
    );
  });
});
