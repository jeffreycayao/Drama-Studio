export type RunGateRequestResult = 'allowed' | 'gated';

export class RunAuthGate<T> {
  private pendingRun: T | null = null;

  get hasPendingRun(): boolean {
    return this.pendingRun !== null;
  }

  async request(
    payload: T,
    authenticated: boolean,
    run: (payload: T) => Promise<void>,
  ): Promise<RunGateRequestResult> {
    if (authenticated) {
      await run(payload);
      return 'allowed';
    }

    if (this.pendingRun === null) this.pendingRun = payload;
    return 'gated';
  }

  async resumeOnce(
    authenticated: boolean,
    run: (payload: T) => Promise<void>,
  ): Promise<boolean> {
    if (!authenticated || this.pendingRun === null) return false;

    const payload = this.pendingRun;
    this.pendingRun = null;
    await run(payload);
    return true;
  }

  cancel(): boolean {
    const hadPendingRun = this.pendingRun !== null;
    this.pendingRun = null;
    return hadPendingRun;
  }
}
