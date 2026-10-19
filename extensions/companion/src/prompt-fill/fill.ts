import type { PromptSite } from '../sites/prompt-sites';

export type PromptInput = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search']);

function isUsable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    return (
      TEXT_INPUT_TYPES.has(element.type) &&
      !element.disabled &&
      !element.readOnly
    );
  }
  return element.isContentEditable || element.contentEditable === 'true';
}

function isOnScreen(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) {
    return false;
  }
  return element.getClientRects().length > 0;
}

/**
 * The site's prompt box, trying its selectors in order. A box that is on
 * screen wins over a hidden one, so generic fallbacks such as `textarea`
 * never pick an off-screen field.
 */
export function findPromptInput(
  site: PromptSite,
  root: ParentNode = document,
): PromptInput | null {
  let firstHidden: PromptInput | null = null;
  for (const selector of site.inputSelectors) {
    let candidates: Element[];
    try {
      candidates = [...root.querySelectorAll(selector)];
    } catch {
      continue;
    }
    for (const candidate of candidates) {
      if (!isUsable(candidate)) continue;
      if (isOnScreen(candidate)) return candidate;
      firstHidden ??= candidate;
    }
  }
  return firstHidden;
}

/**
 * Sets a textarea's value through the prototype setter, so React and other
 * frameworks that track the value notice the change.
 */
function setTextareaValue(
  element: HTMLTextAreaElement | HTMLInputElement,
  text: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element) as object,
    'value',
  )?.set;
  if (setter) setter.call(element, text);
  else element.value = text;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function placeCaretAtEnd(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Builds text nodes and line breaks; never parses the prompt as HTML. */
function replaceWithText(element: HTMLElement, text: string): void {
  const documentRef = element.ownerDocument;
  const fragment = documentRef.createDocumentFragment();
  text.split('\n').forEach((line, index) => {
    if (index > 0) fragment.append(documentRef.createElement('br'));
    if (line) fragment.append(documentRef.createTextNode(line));
  });
  element.replaceChildren(fragment);
}

function tryInsertTextCommand(element: HTMLElement, text: string): boolean {
  const documentRef = element.ownerDocument as Document & {
    execCommand?: (command: string, ui?: boolean, value?: string) => boolean;
  };
  if (typeof documentRef.execCommand !== 'function') return false;
  try {
    // The editing pipeline is what ProseMirror, Quill and Lexical listen to.
    documentRef.execCommand('selectAll', false);
    return documentRef.execCommand('insertText', false, text) === true;
  } catch {
    return false;
  }
}

/**
 * Multi-line text goes in as a paste over the whole box: rich editors such
 * as Lexical (Suno's lyrics) drop the line breaks of an insertText command
 * but keep a paste's. The clipboard itself is never read or changed. Only
 * counts when the editor handled the paste.
 */
function tryPasteText(element: HTMLElement, text: string): boolean {
  const view = element.ownerDocument.defaultView;
  if (
    !view ||
    typeof view.DataTransfer !== 'function' ||
    typeof view.ClipboardEvent !== 'function'
  ) {
    return false;
  }
  try {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const selection = element.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const data = new view.DataTransfer();
    data.setData('text/plain', text);
    const event = new view.ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented && Boolean(element.textContent);
  } catch {
    return false;
  }
}

function fillContentEditable(element: HTMLElement, text: string): void {
  element.focus();
  if (text.includes('\n') && tryPasteText(element, text)) {
    placeCaretAtEnd(element);
    return;
  }
  if (tryInsertTextCommand(element, text) && element.textContent) {
    placeCaretAtEnd(element);
    return;
  }
  replaceWithText(element, text);
  placeCaretAtEnd(element);
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text,
    }),
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Types the prompt into the box. It never presses Send. */
export function fillPromptInput(element: PromptInput, text: string): void {
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement
  ) {
    element.focus();
    setTextareaValue(element, text);
    return;
  }
  fillContentEditable(element, text);
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Polls for the prompt box; single-page apps render it late. */
export function waitForPromptInput(
  site: PromptSite,
  root: ParentNode = document,
  { timeoutMs = 15_000, intervalMs = 500 }: WaitOptions = {},
): Promise<PromptInput | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const attempt = (): void => {
      const input = findPromptInput(site, root);
      if (input) {
        resolve(input);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }
      globalThis.setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}
