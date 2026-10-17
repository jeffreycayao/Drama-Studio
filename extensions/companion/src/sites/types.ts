/**
 * Why a batch stopped for good. None of these is retried: each one needs the
 * person at the keyboard (solve a check, wait for a limit, change a prompt,
 * sign in) or an update to the Companion (the site changed).
 */
export type StopReason =
  'captcha' | 'usage-limit' | 'moderation' | 'sign-in' | 'site-changed';

export interface PageStop {
  reason: StopReason;
  /** Plain-language explanation shown in the side panel. */
  message: string;
}

/**
 * One kind of blocking page state. A signal matches when any selector finds a
 * visible element, or when any pattern matches the text of an alert-like
 * element (see {@link PageSignals.textScopes}).
 */
export interface PageSignal {
  reason: Exclude<StopReason, 'site-changed'>;
  message: string;
  /** Plain CSS selectors (no jQuery extensions). */
  selectors?: readonly string[];
  /** Matched against alert, dialog and toast text only, never the prompt. */
  patterns?: readonly RegExp[];
  /** Matched against `location.pathname`. */
  paths?: readonly RegExp[];
}

export interface PageSignals {
  /**
   * Containers whose text is scanned for patterns. Kept to alerts, dialogs
   * and toasts so a prompt that mentions "rate limit" never stops a batch.
   */
  textScopes: readonly string[];
  signals: readonly PageSignal[];
}

/**
 * The selectors the health check needs. Each entry is a list of selector keys
 * where at least one must match; a missing entry means the site changed.
 */
export type HealthRequirement<TSelectorKey extends string> = readonly [
  TSelectorKey,
  ...TSelectorKey[],
];

export interface SiteAdapter<TSelectors extends Record<string, string>> {
  /** Stable identifier, also used in messages to the desktop app. */
  site: string;
  /** Shown to the user. */
  label: string;
  /** Date of the last selector review, bumped whenever selectors change. */
  revision: string;
  selectors: TSelectors;
  health: readonly HealthRequirement<Extract<keyof TSelectors, string>>[];
  page: PageSignals;
}
