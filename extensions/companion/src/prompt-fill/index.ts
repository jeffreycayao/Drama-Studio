import { DESKTOP_ERROR_MESSAGES } from '../desktop/contracts';
import type { HandoffResponse } from '../desktop/messages';
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
  | 'handoff-failed';

export interface PromptFillDependencies {
  href: string;
  document: Document;
  /** Rewrites the address bar without navigating. */
  replaceUrl: (url: string) => void;
  fetchHandoff: (token: string) => Promise<HandoffResponse>;
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
