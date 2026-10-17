import { describe, expect, it, vi } from 'vitest';

import { RunAuthGate } from '../../src/sidepanel/run-auth-gate';

describe('login-gated Run workflow', () => {
  it('gates an unauthenticated Run without invoking automation', async () => {
    const gate = new RunAuthGate<string>();
    const run = vi.fn<(payload: string) => Promise<void>>();

    await expect(gate.request('prompt-a', false, run)).resolves.toBe('gated');
    expect(run).not.toHaveBeenCalled();
    expect(gate.hasPendingRun).toBe(true);
  });

  it('allows an authenticated Run through unchanged', async () => {
    const gate = new RunAuthGate<string>();
    const run = vi.fn(async () => undefined);

    await expect(gate.request('prompt-a', true, run)).resolves.toBe('allowed');
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('prompt-a');
    expect(gate.hasPendingRun).toBe(false);
  });

  it('resumes a pending Run exactly once after authentication', async () => {
    const gate = new RunAuthGate<string>();
    const run = vi.fn(async () => undefined);

    await gate.request('prompt-a', false, run);
    await expect(gate.resumeOnce(true, run)).resolves.toBe(true);
    await expect(gate.resumeOnce(true, run)).resolves.toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('prompt-a');
  });

  it('cancels the pending Run without a later resume', async () => {
    const gate = new RunAuthGate<string>();
    const run = vi.fn(async () => undefined);

    await gate.request('prompt-a', false, run);
    expect(gate.cancel()).toBe(true);
    await expect(gate.resumeOnce(true, run)).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
