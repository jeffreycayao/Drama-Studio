const PREVIEW_CHARS = 280;
const HOST_ID = 'drama-studio-companion-consent';

/*
 * The bar lives in a closed shadow root so the host page's CSS cannot restyle
 * it and page scripts cannot click it. Colours mirror the desktop app's sf-*
 * tokens; text on lime is always charcoal.
 */
const STYLES = `
:host { all: initial; }
.bar {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 2147483647; box-sizing: border-box;
  width: min(560px, calc(100vw - 32px));
  padding: 14px 16px; border-radius: 12px;
  background: rgb(39 35 27); color: rgb(246 241 230);
  border: 1px solid rgb(66 60 47);
  box-shadow: 0 12px 32px rgb(22 20 15 / 0.55);
  font: 13px/1.45 'Inter Variable', Inter, system-ui, 'Segoe UI', sans-serif;
}
.brand {
  display: flex; align-items: center; gap: 8px; margin: 0 0 6px;
  font: 600 11px/1 'JetBrains Mono Variable', 'JetBrains Mono', Consolas, monospace;
  letter-spacing: 0.08em; text-transform: uppercase; color: rgb(156 148 126);
}
.brand::before {
  content: ''; width: 8px; height: 8px; border-radius: 2px;
  background: rgb(213 250 0);
}
.title { margin: 0 0 8px; font-weight: 600; font-size: 14px; }
.preview {
  margin: 0 0 12px; padding: 8px 10px; max-height: 96px; overflow: auto;
  border-left: 2px solid rgb(104 115 35); border-radius: 4px;
  background: rgb(30 27 21); color: rgb(206 198 178);
  white-space: pre-wrap; word-break: break-word;
}
.note { margin: 0 0 12px; color: rgb(156 148 126); font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
button {
  cursor: pointer; border-radius: 8px; padding: 7px 14px;
  font: 600 13px/1 'Inter Variable', Inter, system-ui, sans-serif;
}
button:focus-visible { outline: 2px solid rgb(213 250 0); outline-offset: 2px; }
.fill { border: 1px solid rgb(213 250 0); background: rgb(213 250 0); color: rgb(30 27 21); }
.fill:hover { background: rgb(226 255 77); }
.dismiss { border: 1px solid rgb(89 82 65); background: transparent; color: rgb(246 241 230); }
.dismiss:hover { border-color: rgb(120 112 92); }
`;

export interface ConsentRequest {
  siteLabel: string;
  text: string;
}

export interface ConsentBar {
  host: HTMLElement;
  fillButton: HTMLButtonElement;
  dismissButton: HTMLButtonElement;
  /** Resolves true on Fill, false on Dismiss or Escape. */
  result: Promise<boolean>;
}

export interface ConsentBarOptions {
  /** Tests only: synthetic clicks are not trusted. */
  allowUntrustedClicks?: boolean;
}

/** Builds and mounts the bar. Exposed for tests; use askToFillFromLink. */
export function mountConsentBar(
  { siteLabel, text }: ConsentRequest,
  documentRef: Document = document,
  { allowUntrustedClicks = false }: ConsentBarOptions = {},
): ConsentBar {
  documentRef.getElementById(HOST_ID)?.remove();

  const host = documentRef.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = documentRef.createElement('style');
  style.textContent = STYLES;

  const bar = documentRef.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Prompt from a link');

  const brand = documentRef.createElement('p');
  brand.className = 'brand';
  brand.textContent = 'Drama Studio™ Companion';

  const title = documentRef.createElement('p');
  title.className = 'title';
  title.textContent = `Prompt from a link: fill it into ${siteLabel}?`;

  const preview = documentRef.createElement('p');
  preview.className = 'preview';
  preview.textContent =
    text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;

  const note = documentRef.createElement('p');
  note.className = 'note';
  note.textContent = `${text.length.toLocaleString('en-US')} characters. Only fill prompts you expect. Nothing is sent until you press Send yourself.`;

  const actions = documentRef.createElement('div');
  actions.className = 'actions';
  const dismissButton = documentRef.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'dismiss';
  dismissButton.textContent = 'Dismiss';
  const fillButton = documentRef.createElement('button');
  fillButton.type = 'button';
  fillButton.className = 'fill';
  fillButton.textContent = 'Fill prompt';
  actions.append(dismissButton, fillButton);

  bar.append(brand, title, preview, note, actions);
  shadow.append(style, bar);

  const result = new Promise<boolean>((resolve) => {
    const finish = (accepted: boolean): void => {
      documentRef.removeEventListener('keydown', onKeydown, true);
      host.remove();
      resolve(accepted);
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(false);
    };
    // Only a real click by the person counts; page scripts cannot fake one.
    fillButton.addEventListener('click', (event) => {
      if (event.isTrusted || allowUntrustedClicks) finish(true);
    });
    dismissButton.addEventListener('click', () => finish(false));
    documentRef.addEventListener('keydown', onKeydown, true);
  });

  (documentRef.body ?? documentRef.documentElement).append(host);
  fillButton.focus();
  return { host, fillButton, dismissButton, result };
}

/**
 * Shows "Prompt from a link: Fill / Dismiss" and resolves with the choice.
 * Nothing is typed into the page until the person presses Fill.
 */
export function askToFillFromLink(
  request: ConsentRequest,
  documentRef: Document = document,
): Promise<boolean> {
  return mountConsentBar(request, documentRef).result;
}

/** A one-button message in the same style, e.g. when a hand-off fails. */
export function showCompanionNotice(
  message: string,
  documentRef: Document = document,
): HTMLElement {
  documentRef.getElementById(HOST_ID)?.remove();
  const host = documentRef.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = documentRef.createElement('style');
  style.textContent = STYLES;
  const bar = documentRef.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'status');
  const brand = documentRef.createElement('p');
  brand.className = 'brand';
  brand.textContent = 'Drama Studio™ Companion';
  const text = documentRef.createElement('p');
  text.className = 'title';
  text.textContent = message;
  const actions = documentRef.createElement('div');
  actions.className = 'actions';
  const close = documentRef.createElement('button');
  close.type = 'button';
  close.className = 'dismiss';
  close.textContent = 'Close';
  close.addEventListener('click', () => host.remove());
  actions.append(close);
  bar.append(brand, text, actions);
  shadow.append(style, bar);
  (documentRef.body ?? documentRef.documentElement).append(host);
  return host;
}
