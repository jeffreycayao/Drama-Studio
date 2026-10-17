/**
 * Where a prompt for this page came from.
 *
 * - `handoff`: a one-time `#ds=<token>` from the Drama Studio desktop app.
 *   Only the token is in the URL; the prompt is fetched over the desktop
 *   link, so it never reaches history or server logs.
 * - `link`: a plain `#prompt=` / `#q=` fragment or `?prompt=` / `?q=` query
 *   from any web page. Anyone can craft such a link, so the person is asked
 *   before anything is filled.
 */
export type PromptSource =
  | { kind: 'handoff'; token: string }
  | { kind: 'link'; text: string; location: 'hash' | 'query' };

/** Longest prompt accepted from a link (about 200 pages of text). */
export const MAX_LINK_PROMPT_CHARS = 200_000;

const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const PROMPT_KEYS = ['prompt', 'q'] as const;
const HANDOFF_KEY = 'ds';

export function isHandoffToken(value: string): boolean {
  return HANDOFF_TOKEN_PATTERN.test(value);
}

function hashParameters(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
}

function firstPrompt(parameters: URLSearchParams): string | null {
  for (const key of PROMPT_KEYS) {
    const value = parameters.get(key);
    if (value && value.trim() !== '') {
      return value.length > MAX_LINK_PROMPT_CHARS
        ? value.slice(0, MAX_LINK_PROMPT_CHARS)
        : value;
    }
  }
  return null;
}

/**
 * Reads the prompt source from a URL. The hash wins over the query string,
 * and a hand-off token wins over a plain prompt.
 */
export function readPromptSource(
  url: URL,
  options: { ignoreQuery?: boolean } = {},
): PromptSource | null {
  const hash = hashParameters(url.hash);
  const token = hash.get(HANDOFF_KEY);
  if (token !== null) {
    return isHandoffToken(token) ? { kind: 'handoff', token } : null;
  }

  const fromHash = firstPrompt(hash);
  if (fromHash !== null) {
    return { kind: 'link', text: fromHash, location: 'hash' };
  }

  if (options.ignoreQuery) return null;
  const fromQuery = firstPrompt(url.searchParams);
  return fromQuery === null
    ? null
    : { kind: 'link', text: fromQuery, location: 'query' };
}

/**
 * Returns the URL without the Companion's parameters, so a reload does not
 * fill the prompt again and the text leaves the address bar.
 */
export function urlWithoutPromptParameters(
  url: URL,
  options: { keepQuery?: boolean } = {},
): string {
  const next = new URL(url.toString());

  const hash = hashParameters(next.hash);
  const hadHashKeys = [HANDOFF_KEY, ...PROMPT_KEYS].some((key) =>
    hash.has(key),
  );
  if (hadHashKeys) {
    hash.delete(HANDOFF_KEY);
    for (const key of PROMPT_KEYS) hash.delete(key);
    const rest = hash.toString();
    next.hash = rest ? `#${rest}` : '';
  }

  if (!options.keepQuery) {
    for (const key of PROMPT_KEYS) next.searchParams.delete(key);
  }

  const result = next.toString();
  // `URL` keeps a bare "#" after clearing the hash; drop it.
  return result.endsWith('#') ? result.slice(0, -1) : result;
}
