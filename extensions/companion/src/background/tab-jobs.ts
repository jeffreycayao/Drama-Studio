/**
 * Which Drama Studio browser job a tab is working on, so a capture from that
 * tab is filed with its prompt. Kept in session storage: the worker may
 * sleep between the fill and the capture, and nothing survives a restart.
 */
export interface TabJob {
  jobId: string;
  site: string;
  prompt: string;
}

export interface SessionStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const keyFor = (tabId: number): string => `ds-tab-job-${tabId}`;

function isTabJob(value: unknown): value is TabJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.jobId === 'string' &&
    typeof job.site === 'string' &&
    typeof job.prompt === 'string'
  );
}

export function createTabJobs(storage: SessionStorageLike) {
  return {
    async remember(tabId: number, job: TabJob): Promise<void> {
      await storage.set({ [keyFor(tabId)]: { ...job } });
    },
    async get(tabId: number): Promise<TabJob | null> {
      const key = keyFor(tabId);
      const stored = (await storage.get(key))[key];
      return isTabJob(stored) ? stored : null;
    },
    async forget(tabId: number): Promise<void> {
      await storage.remove(keyFor(tabId));
    },
  };
}
