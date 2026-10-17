import type { PageSignals, PageStop } from './types';

const MAX_SCOPE_TEXT_CHARS = 4_000;

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) {
    return false;
  }
  return true;
}

function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    // A malformed selector in an adapter must never break the batch runner.
    return [];
  }
}

/**
 * Text of alerts, dialogs and toasts, without anything the user can type
 * into, so a prompt that mentions "rate limit" never reads as a limit.
 */
export function collectAlertText(
  root: ParentNode,
  scopes: readonly string[],
): string[] {
  const texts: string[] = [];
  const seen = new Set<Element>();
  for (const scope of scopes) {
    for (const element of safeQueryAll(root, scope)) {
      if (seen.has(element) || !isVisible(element)) continue;
      seen.add(element);
      const clone = element.cloneNode(true) as Element;
      for (const editable of safeQueryAll(
        clone,
        'textarea, input, [contenteditable="true"], [contenteditable=""]',
      )) {
        editable.remove();
      }
      const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) texts.push(text.slice(0, MAX_SCOPE_TEXT_CHARS));
    }
  }
  return texts;
}

/**
 * Returns why the page cannot take another prompt, or null when it can.
 * Signals are checked in adapter order, so a CAPTCHA wins over a limit.
 */
export function detectPageStop(
  page: PageSignals,
  root: Document = document,
  pathname: string = root.location?.pathname ?? '/',
): PageStop | null {
  let alertTexts: string[] | null = null;
  for (const signal of page.signals) {
    if (signal.paths?.some((pattern) => pattern.test(pathname))) {
      return { reason: signal.reason, message: signal.message };
    }
    if (
      signal.selectors?.some((selector) =>
        safeQueryAll(root, selector).some(isVisible),
      )
    ) {
      return { reason: signal.reason, message: signal.message };
    }
    if (signal.patterns?.length) {
      alertTexts ??= collectAlertText(root, page.textScopes);
      if (
        alertTexts.some((text) =>
          signal.patterns?.some((pattern) => pattern.test(text)),
        )
      ) {
        return { reason: signal.reason, message: signal.message };
      }
    }
  }
  return null;
}

export const SITE_CHANGED_MESSAGE =
  'This site changed and the Companion cannot find its prompt box. An update is pending; nothing was sent.';
