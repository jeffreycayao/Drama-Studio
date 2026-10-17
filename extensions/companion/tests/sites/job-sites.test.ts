import { describe, expect, it } from 'vitest';

import {
  findJobSite,
  jobSiteRunsOn,
  promptSiteForJob,
} from '../../src/sites/job-sites';

describe('job sites', () => {
  it('runs Grok Imagine jobs on Grok only', () => {
    expect(jobSiteRunsOn('grok-imagine', 'grok')).toBe(true);
    expect(jobSiteRunsOn('grok-imagine', 'chatgpt')).toBe(false);
    expect(jobSiteRunsOn('unknown', 'grok')).toBe(false);
  });

  it('tries the Imagine prompt box before the generic Grok ones', () => {
    const site = promptSiteForJob('grok-imagine');
    expect(site?.label).toBe('Grok Imagine');
    expect(site?.inputSelectors[0]).toBe(
      findJobSite('grok-imagine')?.inputSelectors[0],
    );
    expect(site?.inputSelectors).toContain('textarea');
  });
});
