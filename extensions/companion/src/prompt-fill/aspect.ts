import type { AspectMenu } from '../sites/ai-sites';
import type { WaitOptions } from './fill';

/**
 * Sets a job's shape (aspect ratio) in the site's own menu: open the menu,
 * pick the matching item, check the menu now shows it. Those are the only
 * clicks; Generate is never pressed. Anything unexpected leaves the page as
 * it was and the person is told to set the shape themselves.
 */
export type AspectOutcome = 'set' | 'no-menu' | 'no-option' | 'unconfirmed';

const RATIO = /^\d{1,2}\s*:\s*\d{1,2}$/;

const normalise = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, '');

/** "16:9" inside "16:9 Widescreen", but not inside "21:9" or "16:90". */
function textShowsRatio(text: string, ratio: string): boolean {
  const escaped = ratio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\d])${escaped}($|[^\\d])`).test(normalise(text));
}

function isClickable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) {
    return false;
  }
  if (element instanceof HTMLButtonElement) {
    if (element.disabled) return false;
    // A submit button inside a form could send the form: never touch it.
    if (element.type === 'submit' && element.form !== null) return false;
  }
  return element.getAttribute('aria-disabled') !== 'true';
}

function query(root: ParentNode, selector: string): Element[] {
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

/** The button whose own text is a ratio: the site's shape menu. */
export function findAspectButton(
  menu: AspectMenu,
  root: ParentNode,
): HTMLElement | null {
  for (const selector of menu.menuButtons) {
    for (const candidate of query(root, selector)) {
      if (
        isClickable(candidate) &&
        RATIO.test(candidate.textContent?.trim() ?? '')
      ) {
        return candidate;
      }
    }
  }
  return null;
}

function findOption(
  menu: AspectMenu,
  root: ParentNode,
  ratio: string,
): HTMLElement | null {
  for (const selector of menu.options) {
    for (const candidate of query(root, selector)) {
      if (
        isClickable(candidate) &&
        textShowsRatio(candidate.textContent ?? '', ratio)
      ) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * A person's press: menus built on pointer events open on pointerdown,
 * others on click, so both are sent (as the batch runner does).
 */
function press(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView;
  for (const type of [
    'pointerover',
    'mouseover',
    'pointerdown',
    'mousedown',
    'pointerup',
    'mouseup',
    'click',
  ]) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        detail: 1,
        view,
      }),
    );
  }
}

function closeMenu(root: Document): void {
  root.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
}

function waitFor<T>(
  find: () => T | null,
  { timeoutMs = 3_000, intervalMs = 100 }: WaitOptions = {},
): Promise<T | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const attempt = (): void => {
      const found = find();
      if (found) {
        resolve(found);
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

export async function setAspect(
  menu: AspectMenu,
  root: Document,
  ratio: string,
  wait?: WaitOptions,
): Promise<AspectOutcome> {
  const button = findAspectButton(menu, root);
  if (!button) return 'no-menu';
  if (normalise(button.textContent) === normalise(ratio)) return 'set';

  press(button);
  const option = await waitFor(() => findOption(menu, root, ratio), wait);
  if (!option) {
    closeMenu(root);
    return 'no-option';
  }
  press(option);

  // The page may re-render the button, so look it up again.
  const confirmed = await waitFor(() => {
    const current = findAspectButton(menu, root);
    return current && normalise(current.textContent) === normalise(ratio)
      ? current
      : null;
  }, wait);
  return confirmed ? 'set' : 'unconfirmed';
}
