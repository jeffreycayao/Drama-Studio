import { DESKTOP_ERROR_MESSAGES } from '../desktop/contracts';
import type { JobState } from '../desktop/contracts';
import type { HandoffResponse, JobResponse } from '../desktop/messages';
import {
  findJobSite,
  jobSiteRunsOn,
  promptSiteForJob,
} from '../sites/job-sites';
import { promptSiteForHostname, type PromptSite } from '../sites/prompt-sites';
import {
  attachReferenceFiles,
  readReferenceFile,
  type CreateTransfer,
  type FetchReferenceChunk,
} from './attach';
import { setAspect } from './aspect';
import type { ConsentRequest } from './consent-bar';
import { fillSong, switchToSimpleMode } from './song';
import type { SongFields } from '../sites/ai-sites';
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
  /** Reads a job's reference files; without it they are left to the person. */
  fetchReferenceChunk?: FetchReferenceChunk;
  createTransfer?: CreateTransfer;
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
const JOB_ATTACHED_MESSAGE =
  ' Your reference files were added; check they show on the page.';
const JOB_SHAPE_MESSAGE = ' The shape is set too.';

function settingsNote(params: {
  aspect?: string | undefined;
  durationSeconds?: number | undefined;
}): string {
  const parts: string[] = [];
  if (params.aspect) parts.push(`the shape to ${params.aspect}`);
  if (params.durationSeconds) {
    parts.push(`the length to ${params.durationSeconds} seconds`);
  }
  return parts.length > 0 ? ` Set ${parts.join(' and ')} on the page.` : '';
}

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
  const aiSite = findJobSite(job.site);
  if (!jobSite || !aiSite) {
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
  if (job.kind === 'audio' && aiSite.song && job.params.custom) {
    return runSongFill(jobSite, aiSite.song, job, dependencies);
  }
  // Suno keeps its Simple box on the page while Advanced is open, so a
  // simple song switches to the Simple tab first.
  if (job.kind === 'audio' && aiSite.song) {
    switchToSimpleMode(aiSite.song, dependencies.document);
  }
  const input = await waitForPromptInput(
    jobSite,
    dependencies.document,
    dependencies.wait,
  );
  if (!input) {
    void dependencies.reportJob(job.jobId, 'failed', 'prompt box not found');
    dependencies.notify(
      `Could not find the ${jobSite.label} prompt box, so nothing was filled. The site may have changed.`,
    );
    return 'no-input';
  }
  fillPromptInput(input, job.prompt);

  let referenceNote = '';
  if (job.references.length > 0) {
    referenceNote = JOB_REFERENCE_MESSAGE;
    const fetchChunk = dependencies.fetchReferenceChunk;
    if (fetchChunk) {
      const files: File[] = [];
      for (const reference of job.references) {
        const file = await readReferenceFile(job.jobId, reference, fetchChunk);
        if (file) files.push(file);
      }
      const attached =
        files.length > 0
          ? attachReferenceFiles(
              aiSite,
              dependencies.document,
              files,
              input,
              dependencies.createTransfer,
            )
          : 'none';
      if (attached !== 'none' && files.length === job.references.length) {
        referenceNote = JOB_ATTACHED_MESSAGE;
      }
    }
  }
  // The shape goes last, after the references (the plan's step order).
  let shapeSet = false;
  if (job.kind !== 'audio' && job.params.aspect && aiSite.aspectMenu) {
    shapeSet =
      (await setAspect(
        aiSite.aspectMenu,
        dependencies.document,
        job.params.aspect,
        dependencies.wait,
      )) === 'set';
  }
  void dependencies.reportJob(job.jobId, 'waiting-user');
  dependencies.notify(
    (job.kind === 'audio' ? SONG_READY_MESSAGE : JOB_READY_MESSAGE) +
      referenceNote +
      (shapeSet ? JOB_SHAPE_MESSAGE : '') +
      (job.kind === 'audio'
        ? ''
        : settingsNote({
            ...job.params,
            aspect: shapeSet ? undefined : job.params.aspect,
          })),
  );
  return 'filled';
}

const SONG_READY_MESSAGE =
  'The song from Drama Studio is filled in. Check it, then press Create on the page when you are ready.';

async function runSongFill(
  site: PromptSite,
  song: SongFields,
  job: Extract<JobResponse, { ok: true }>,
  dependencies: PromptFillDependencies,
): Promise<PromptFillOutcome> {
  const result = await fillSong(
    site,
    song,
    dependencies.document,
    job.prompt,
    job.params,
    dependencies.wait,
  );
  if (!result.style) {
    void dependencies.reportJob(job.jobId, 'failed', 'style box not found');
    dependencies.notify(
      `Could not find the ${site.label} style box, so nothing was filled. Switch to Custom on the page and try again, or paste the song in yourself.`,
    );
    return 'no-input';
  }
  const notes: string[] = [];
  if (result.lyrics === false) {
    notes.push('The lyrics box was not found; paste the lyrics yourself.');
  }
  if (result.title === false) {
    notes.push('The title box was not found; type the title yourself.');
  }
  if (job.params.instrumental) {
    notes.push('Turn on Instrumental on the page.');
  }
  void dependencies.reportJob(job.jobId, 'waiting-user');
  dependencies.notify([SONG_READY_MESSAGE, ...notes].join(' '));
  return 'filled';
}
