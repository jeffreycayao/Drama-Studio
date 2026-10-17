import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  new URL('../../src/sidepanel/App.vue', import.meta.url),
  'utf8',
);

describe('App login-gated Run wiring', () => {
  it('keeps every tool mounted while routing the sole queue event through auth', () => {
    expect(appSource).toContain('<ModeSelector');
    expect(appSource).toContain('<PromptComposer');
    expect(appSource).toContain('<QueuePanel');
    expect(appSource).toContain('<SettingsPanel');
    expect(appSource).toContain('<DebugPanel');
    expect(appSource).toContain('@queue="requestQueue"');
    expect(appSource).not.toContain('@queue="queue"');
    expect(appSource).toContain('auth.ensureActiveSession()');
    expect(appSource).toContain(
      'runAuthGate.resumeOnce(true, runAuthorizedPayloads)',
    );
    expect(appSource).toContain('usageAuthorizer.reserveRun(');
    expect(appSource).toContain('usageAuthorizer.consumeReservation(');
    expect(appSource).toContain('usageAuthorizer.finalizeReservation(');
    expect(appSource).toMatch(/usageAuthorizer\s*\.cancelReservation\(/u);
    expect(appSource).toContain('await commitPromptGroup(');
    expect(appSource).toContain('await queryPromptGroupCommitStatus(');
    expect(appSource).toContain('await releasePromptGroup(');
    expect(appSource).toContain('await saveInFlightRunCommit(');
    expect(appSource).toContain("lifecycle: 'legacy-immediate'");
    expect(appSource.indexOf('await saveInFlightRunCommit(')).toBeLessThan(
      appSource.indexOf('usageAuthorizer.authorizeLegacyRun('),
    );
    expect(appSource).toContain(
      'will remain blocked until usage finalization succeeds',
    );
    expect(appSource).toContain('recoverInterruptedRunCommits()');
    expect(appSource).toContain(
      ':account-display-name="auth.state.accountDisplayName"',
    );
    expect(appSource).toContain(':account-email="auth.state.accountEmail"');
    expect(appSource).toContain(':plan-code="auth.state.planCode"');
    expect(appSource).toContain(':is-pro="true"');
    expect(appSource).toContain('@guide="openGrokAutomatorGuide"');
    expect(appSource).toContain('DEPLOYED_GROK_AUTOMATOR_GUIDE_URL');
    expect(appSource).not.toContain(
      '@guide="openPlatformPage(\'/guide/grok-automator\')"',
    );
    expect(appSource).not.toContain('isWithinLocalFreeRunLimit(');
  });

  it('offers an accessible Google-only prompt without credential fields', () => {
    expect(appSource).toContain('title="Sign in with Google"');
    expect(appSource).toContain('Continue with Google');
    expect(appSource).toContain('auth.state.userCode');
    expect(appSource).toContain(
      'aria-describedby="google-sign-in-description"',
    );
    expect(appSource).toContain(':inert="showGoogleSignIn"');
    expect(appSource).toContain("event.key !== 'Escape'");
    expect(appSource).not.toMatch(/type=["'](?:email|password)["']/u);
    expect(appSource).not.toMatch(
      /magic link|one-time password|facebook sign-in/iu,
    );
  });
});
