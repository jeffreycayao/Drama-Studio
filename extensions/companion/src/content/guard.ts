import { grokAdapter } from '../sites/grok';
import { checkSiteHealth, type SiteHealth } from '../sites/health';
import { detectPageStop } from '../sites/page-state';
import type { PageStop } from '../sites/types';
import { query } from './dom/jquery-bridge';
import { logWarning } from './logger';
import { downloadQueue } from './state';
import { publishPromptGroupStatus } from './status';
import type { PromptGroup } from './types';

/** CAPTCHA, usage limit, moderation or sign-in on the Grok tab, if any. */
export function detectGrokPageStop(root: Document = document): PageStop | null {
  return detectPageStop(grokAdapter.page, root);
}

/** Whether Grok's page still has what the batch runner needs. */
export function checkGrokHealth(): SiteHealth {
  return checkSiteHealth(grokAdapter, (selector) => query(selector).length);
}

/**
 * Stops the whole batch for good: no prompt left in it is sent or retried,
 * and its pending downloads are cancelled (an upscale is a new generation).
 */
export function stopGroup(group: PromptGroup, stop: PageStop): void {
  if (group.stop) return;
  group.stop = stop;
  group.isCancelling = true;
  group.pendingIndexes.splice(0);
  for (const downloadGroup of downloadQueue) {
    if (downloadGroup.id === group.id) downloadGroup.isCancelling = true;
  }
  logWarning(`Batch stopped (${stop.reason}): ${stop.message}`);
  publishPromptGroupStatus(group);
}

const RETRYABLE_FAILURE =
  /time(?:d)? ?out|timeout|network|failed to fetch|could not find element ids|did not respond/i;

/**
 * Only waits that ran out and network errors are retried. Anything else
 * (a control that is missing, a prompt box that would not fill) points at
 * the page, and repeating it would only repeat the problem.
 */
export function isRetryableFailure(error: string | undefined): boolean {
  return error !== undefined && RETRYABLE_FAILURE.test(error);
}
