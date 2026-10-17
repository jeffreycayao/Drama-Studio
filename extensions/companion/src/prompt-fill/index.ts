import { DESKTOP_ERROR_MESSAGES } from '../desktop/contracts';
import type { JobState } from '../desktop/contracts';
import type { HandoffResponse, JobResponse } from '../desktop/messages';
import { jobSiteRunsOn, promptSiteForJob } from '../sites/job-sites';
import { promptSiteForHostname, type PromptSite } from '../sites/prompt-sites';
import type { ConsentRequest } from './consent-bar';
import { fillPromptInput, waitForPromptInput, type WaitOptions } from './fill';
import { readPromptSource, urlWithoutPromptParameters } from './source';

export type PromptFillOutcome =
  | 'no-prompt'
  | 'unsupported-site'
  | 'filled'
  | 'dismissed'
  | 'no-input'
  | 'handoff-failed'
  | 'job-failed';

export interface PromptFillDependencies {
  href: string;
  document: Document;
  /** Rewrites the address bar without navigating. */
  replaceUrl: (url: string) => void;
  fetchHandoff: (token: string) => Promise<HandoffResponse>;
  fetchJob: (token: string) => Promise<JobResponse>;
  /** Best effort: tells Drama Studio how the job is going. */
  reportJob: (
    jobId: string,
    state: JobState,
    reason?: string,
  ) => Promise<unknown>;
  confirm: (request: ConsentRequest) => Promise<boolean>;
  notify: (message: string) => void;
  wait?: WaitOptions;
}

async function fillWhenReady(
  site: PromptSite,
  text: string,
  dependencies: PromptFillDependencies,
): Promise<PromptFillOutcome> {
  const input = await waitForPromptInput(
    site,
    dependencies.document,
    dependencies.wait,
  );
  if (!input) {
    dependencies.notify(
      `Could not find the ${site.label} prompt box, so nothing was filled. The site may have changed.`,
    );
    return 'no-input';
  }
  fillPromptInput(input, text);
  return 'filled';
}

/**
 * Prompt-fill for AI chat sites (the former long-prompt helper).
 *
 * - `#ds=<token>` from Drama Studio: fetched over the desktop link and filled.
 * - `#dsjob=<token>`: a Drama Studio browser job, filled the same way; the
 *   job then waits for the person to press the site's own Generate.
 * - `#prompt=` / `?prompt=` from any other link: shown first, filled only
 *   when the person presses Fill.
 *
 * Either way the parameters leave the address bar at once, and Send is
 * never pressed.
 */
export async function runPromptFill(
  dependencies: PromptFillDependencies,
): Promise<PromptFillOutcome> {
  const url = new URL(dependencies.href);
  const site = promptSiteForHostname(url.hostname);
  if (!site) return 'unsupported-site';

  const source = readPromptSource(url, {
    ignoreQuery: site.handlesQueryParameter === true,
  });
  if (!source) return 'no-prompt';

  dependencies.replaceUrl(
    urlWithoutPromptParameters(url, {
      keepQuery: site.handlesQueryParameter === true,
    }),
  );

  if (source.kind === 'job') {
    return runJobFill(site, source.token, dependencies);
  }

  if (source.kind === 'handoff') {
    const handoff = await dependencies.fetchHandoff(source.token);
    if (!handoff.ok) {
      dependencies.notify(DESKTOP_ERROR_MESSAGES[handoff.code]);
      return 'handoff-failed';
    }
    return fillWhenReady(site, handoff.prompt, dependencies);
  }

  const accepted = await dependencies.confirm({
    siteLabel: site.label,
    text: source.text,
  });
  if (!accepted) return 'dismissed';
  return fillWhenReady(site, source.text, dependencies);
}

const JOB_READY_MESSAGE =
  'The prompt from Drama Studio is filled in. Check it, then press Generate on the page when you are ready.';
const JOB_REFERENCE_MESSAGE =
  ' Add your reference files on the page yourself for now.';

async function runJobFill(
  site: PromptSite,
  token: string,
  dependencies: PromptFillDependencies,
): Promise<PromptFillOutcome> {
  const job = await dependencies.fetchJob(token);
  if (!job.ok) {
    dependencies.notify(DESKTOP_ERROR_MESSAGES[job.code]);
    return 'job-failed';
  }
  const jobSite = jobSiteRunsOn(job.site, site.id)
    ? promptSiteForJob(job.site)
    : null;
  if (!jobSite) {
    // Drama Studio checks the site too; this only guards a mismatched link.
    void dependencies.reportJob(
      job.jobId,
      'failed',
      'opened on a different site',
    );
    dependencies.notify(DESKTOP_ERROR_MESSAGES['handoff-wrong-site']);
    return 'job-failed';
  }
  void dependencies.reportJob(job.jobId, 'filling');
  const outcome = await fillWhenReady(jobSite, job.prompt, dependencies);
  if (outcome !== 'filled') {
    void dependencies.reportJob(job.jobId, 'failed', 'prompt box not found');
    return outcome;
  }
  void dependencies.reportJob(job.jobId, 'waiting-user');
  dependencies.notify(
    job.references.length > 0
      ? JOB_READY_MESSAGE + JOB_REFERENCE_MESSAGE
      : JOB_READY_MESSAGE,
  );
  return 'filled';
}
