import {
  PROMPT_SITES,
  type PromptSite,
  type PromptSiteId,
} from './prompt-sites';

/**
 * Sites a Drama Studio browser job can open (docs/PLAN_AI_BROWSER_WORKSPACE.md).
 * Ids match JOB_SITES in electron/companionLink/jobs.cjs. Each job site runs
 * on a prompt site's hostnames, with its own prompt box tried first.
 * Selectors are plain CSS, most specific first; Send is never pressed.
 */
export interface JobSite {
  id: string;
  label: string;
  promptSite: PromptSiteId;
  /** Path prefixes on the prompt site's hostnames. */
  paths: readonly string[];
  inputSelectors: readonly string[];
}

export const JOB_SITES: readonly JobSite[] = [
  {
    id: 'grok-imagine',
    label: 'Grok Imagine',
    promptSite: 'grok',
    paths: ['/imagine'],
    inputSelectors: [
      "div[data-testid='drop-ui'] textarea",
      "form div[contenteditable='true']",
    ],
  },
];

export function findJobSite(id: string): JobSite | null {
  return JOB_SITES.find((site) => site.id === id) ?? null;
}

/** True when a job for `jobSiteId` may be filled on this prompt site. */
export function jobSiteRunsOn(
  jobSiteId: string,
  promptSiteId: string,
): boolean {
  return findJobSite(jobSiteId)?.promptSite === promptSiteId;
}

/** The prompt site with the job site's own prompt boxes tried first. */
export function promptSiteForJob(jobSiteId: string): PromptSite | null {
  const jobSite = findJobSite(jobSiteId);
  if (!jobSite) return null;
  const base = PROMPT_SITES.find((site) => site.id === jobSite.promptSite);
  if (!base) return null;
  return {
    ...base,
    label: jobSite.label,
    inputSelectors: [...jobSite.inputSelectors, ...base.inputSelectors],
  };
}
