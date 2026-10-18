import { hostMatchesPattern, type AiSite } from '../sites/ai-sites';

/**
 * An on-page "Send to Drama Studio" button over the results a site adapter
 * recognises (`resultMedia` in src/sites/ai-sites.ts). It does the same as
 * the right-click menu: the background downloads that one file and hands it
 * to Drama Studio. It shows only while the pointer is over a result, and
 * only a real click by the person sends anything.
 */
const HOST_ID = 'drama-studio-companion-capture';
const LABEL = 'Send to Drama Studio';
const SENDING_LABEL = 'Sending…';
const SEND_FAILED_MESSAGE =
  'Could not send this to Drama Studio. Try again in a moment.';

const STYLES = `
:host { all: initial; }
button {
  position: fixed; z-index: 2147483646; box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgb(213 250 0); background: rgb(213 250 0);
  color: rgb(30 27 21);
  box-shadow: 0 6px 18px rgb(22 20 15 / 0.45);
  font: 600 12px/1 'Inter Variable', Inter, system-ui, 'Segoe UI', sans-serif;
}
button::before {
  content: ''; width: 7px; height: 7px; border-radius: 2px;
  background: rgb(30 27 21);
}
button:hover { background: rgb(226 255 77); }
button:focus-visible { outline: 2px solid rgb(246 241 230); outline-offset: 2px; }
button[disabled] { cursor: progress; opacity: 0.8; }
button[hidden] { display: none; }
`;

export type SendMedia = (srcUrl: string) => Promise<string>;

export interface CaptureButtonOptions {
  site: AiSite;
  document?: Document;
  /** The live page path; the button only shows on the site's paths. */
  pathname?: () => string;
  send: SendMedia;
  notify: (message: string) => void;
  /** Tests only: synthetic clicks are not trusted. */
  allowUntrustedClicks?: boolean;
}

export interface CaptureButton {
  host: HTMLElement;
  button: HTMLButtonElement;
  /** The result the button is over right now, if any. */
  current: () => HTMLElement | null;
  dispose: () => void;
}

/** The https address of a result's file, or null for blob:/data: etc. */
export function resultMediaUrl(element: Element): string | null {
  let candidate = '';
  if (element instanceof HTMLImageElement) {
    candidate = element.currentSrc || element.src;
  } else if (element instanceof HTMLVideoElement) {
    candidate =
      element.currentSrc ||
      element.src ||
      (element.querySelector('source[src]') as HTMLSourceElement | null)?.src ||
      '';
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function matchesAny(element: Element, selectors: readonly string[]): boolean {
  return selectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}

/** True when `element` is one of the site's results, from its own hosts. */
export function isSiteResult(site: AiSite, element: Element): boolean {
  if (!site.resultMedia || !matchesAny(element, site.resultMedia)) {
    return false;
  }
  const src = resultMediaUrl(element);
  if (!src) return false;
  const { hostname } = new URL(src);
  return site.mediaHosts.some((pattern) =>
    hostMatchesPattern(pattern, hostname),
  );
}

function onSitePath(site: AiSite, pathname: string): boolean {
  return site.paths.some((prefix) => pathname.startsWith(prefix));
}

export function mountCaptureButton({
  site,
  document: documentRef = document,
  pathname = () => documentRef.location.pathname,
  send,
  notify,
  allowUntrustedClicks = false,
}: CaptureButtonOptions): CaptureButton {
  documentRef.getElementById(HOST_ID)?.remove();
  const host = documentRef.createElement('div');
  host.id = HOST_ID;
  // Closed, so the page's CSS cannot restyle it and its scripts cannot reach it.
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = documentRef.createElement('style');
  style.textContent = STYLES;
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.textContent = LABEL;
  button.hidden = true;
  shadow.append(style, button);
  documentRef.documentElement.append(host);

  let current: HTMLElement | null = null;
  let sending = false;

  const hide = (): void => {
    if (sending) return;
    current = null;
    button.hidden = true;
  };

  const showFor = (media: HTMLElement): void => {
    current = media;
    const rect = media.getBoundingClientRect();
    button.style.top = `${Math.max(8, rect.top + 8)}px`;
    button.style.left = `${Math.max(8, rect.right - 8)}px`;
    button.style.transform = 'translateX(-100%)';
    button.hidden = false;
  };

  /** The result under the pointer, even when the site lays a hover layer on it. */
  const resultAt = (event: MouseEvent): HTMLElement | null => {
    const stack: Element[] = [];
    if (event.target instanceof Element) stack.push(event.target);
    if (typeof documentRef.elementsFromPoint === 'function') {
      stack.push(
        ...documentRef.elementsFromPoint(event.clientX, event.clientY),
      );
    }
    for (const element of stack) {
      if (element instanceof HTMLElement && isSiteResult(site, element)) {
        return element;
      }
    }
    return null;
  };

  const onPointer = (event: MouseEvent): void => {
    if (sending) return;
    if (event.target === host) return;
    if (!onSitePath(site, pathname())) {
      hide();
      return;
    }
    const media = resultAt(event);
    if (media) showFor(media);
    else hide();
  };

  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted && !allowUntrustedClicks) return;
    const media = current;
    const src = media ? resultMediaUrl(media) : null;
    if (sending || !media || !src || !isSiteResult(site, media)) return;
    sending = true;
    button.disabled = true;
    button.textContent = SENDING_LABEL;
    void send(src)
      .then(notify, () => notify(SEND_FAILED_MESSAGE))
      .finally(() => {
        sending = false;
        button.disabled = false;
        button.textContent = LABEL;
        hide();
      });
  };

  // Keep the page from treating presses on the button as its own.
  const swallow = (event: Event): void => event.stopPropagation();

  documentRef.addEventListener('mouseover', onPointer, true);
  documentRef.addEventListener('scroll', hide, true);
  button.addEventListener('click', onClick);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    button.addEventListener(type, swallow);
  }

  return {
    host,
    button,
    current: () => current,
    dispose: () => {
      documentRef.removeEventListener('mouseover', onPointer, true);
      documentRef.removeEventListener('scroll', hide, true);
      host.remove();
    },
  };
}

/** The site on this page that has an on-page button, if any. */
export function captureButtonSite(sites: readonly AiSite[]): AiSite | null {
  return sites.find((site) => (site.resultMedia?.length ?? 0) > 0) ?? null;
}
