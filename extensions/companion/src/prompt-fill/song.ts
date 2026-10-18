import type { JobParams } from '../desktop/contracts';
import type { SongFields } from '../sites/ai-sites';
import type { PromptSite } from '../sites/prompt-sites';
import {
  fillPromptInput,
  findPromptInput,
  waitForPromptInput,
  type WaitOptions,
} from './fill';

/**
 * Custom mode on a music site (Suno): the style of music, the lyrics and the
 * title each have their own box. The only click is the mode tab named in
 * `customMode`; Create (or Generate) is never pressed.
 */
export interface SongFillResult {
  style: boolean;
  /** null when there were no lyrics to fill (or the song is instrumental). */
  lyrics: boolean | null;
  title: boolean | null;
}

const isPressed = (element: Element): boolean =>
  ['aria-selected', 'aria-pressed', 'aria-checked'].some(
    (name) => element.getAttribute(name) === 'true',
  ) || element.getAttribute('data-state') === 'active';

/**
 * Clicks the mode tab with one of `names` unless it is already on. Only
 * real tabs and radio options count: a plain button with the same word (on
 * Suno, Duration › "Custom") is never touched. True if the tab was found.
 */
export function switchToMode(
  names: readonly string[],
  root: ParentNode,
): boolean {
  const labels = names.map((label) => label.toLowerCase());
  const candidates = [...root.querySelectorAll('[role="tab"], [role="radio"]')];
  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) continue;
    // A submit button inside a form could send the form: never touch it.
    // (A <button> with no type is a submit button, but outside a form it
    // only acts as a plain button, which is how mode tabs are built.)
    if (
      candidate instanceof HTMLButtonElement &&
      candidate.type === 'submit' &&
      candidate.form !== null
    ) {
      continue;
    }
    const text = candidate.textContent?.trim().toLowerCase() ?? '';
    if (!labels.includes(text)) continue;
    if (!isPressed(candidate)) candidate.click();
    return true;
  }
  return false;
}

export function switchToCustomMode(
  song: SongFields,
  root: ParentNode,
): boolean {
  return switchToMode(song.customMode, root);
}

export function switchToSimpleMode(
  song: SongFields,
  root: ParentNode,
): boolean {
  return switchToMode(song.simpleMode, root);
}

function boxes(site: PromptSite, selectors: readonly string[]): PromptSite {
  return { ...site, inputSelectors: selectors };
}

export async function fillSong(
  site: PromptSite,
  song: SongFields,
  root: Document,
  style: string,
  params: JobParams,
  wait?: WaitOptions,
): Promise<SongFillResult> {
  if (!findPromptInput(boxes(site, song.style), root)) {
    switchToCustomMode(song, root);
  }
  const styleBox = await waitForPromptInput(
    boxes(site, song.style),
    root,
    wait,
  );
  if (!styleBox) return { style: false, lyrics: null, title: null };
  fillPromptInput(styleBox, style);

  let lyrics: boolean | null = null;
  if (params.lyrics && !params.instrumental) {
    const box = findPromptInput(boxes(site, song.lyrics), root);
    if (box) fillPromptInput(box, params.lyrics);
    lyrics = Boolean(box);
  }
  let title: boolean | null = null;
  if (params.title) {
    const box = findPromptInput(boxes(site, song.title), root);
    if (box) fillPromptInput(box, params.title);
    title = Boolean(box);
  }
  return { style: true, lyrics, title };
}
