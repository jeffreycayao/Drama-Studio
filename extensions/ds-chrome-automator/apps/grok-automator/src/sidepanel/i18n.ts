import { readonly, ref } from 'vue';

import { loadLocale, saveLocale } from './storage';

/** Locale contract recovered from the signed 2.6.3 bundle. */
export const RECOVERED_LOCALES = [
  'en',
  'ar',
  'bn',
  'de',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'nl',
  'pt',
  'ru',
  'th',
  'tl',
  'tr',
  'ur',
  'vi',
  'zh',
] as const;

export type RecoveredLocale = (typeof RECOVERED_LOCALES)[number];

/** Locales with a complete, maintainable message catalog in active source. */
export const ACTIVE_LOCALES = ['en'] as const;
export type ActiveLocale = (typeof ACTIVE_LOCALES)[number];

export interface DocumentLocaleRoot {
  lang: string;
  dir: string;
}

const english = {
  title: 'Grok Automator™',
  description: 'Control batch automation process for grok.com.',
  control: 'Control',
  settings: 'Setting',
  debug: 'Debug Logs',
  openGrok: 'Open Grok Imagine',
  notOnGrok: 'Switch to a Grok tab to run automation.',
  tipTitle: 'Before you start',
  tipBody:
    'Keep the Grok Imagine tab open. Long batches are more reliable with conservative concurrency and delays.',
} as const;

type MessageKey = keyof typeof english;
const locale = ref<ActiveLocale>('en');

export function isActiveLocale(value: string): value is ActiveLocale {
  return (ACTIVE_LOCALES as readonly string[]).includes(value);
}

export function resolveActiveLocale(value: string): ActiveLocale {
  return isActiveLocale(value) ? value : 'en';
}

export function applyDocumentLocale(
  next: RecoveredLocale,
  root: DocumentLocaleRoot = document.documentElement,
): void {
  root.lang = next;
  root.dir = next === 'ar' || next === 'ur' ? 'rtl' : 'ltr';
}

export function t(key: MessageKey): string {
  // English is the editable source catalog. See I18N_RECOVERY.md for the exact
  // location of the recovered 20-language catalog awaiting semantic import.
  return english[key];
}

export async function initializeLocale(): Promise<void> {
  const stored = await loadLocale();
  const next = resolveActiveLocale(stored);
  locale.value = next;
  applyDocumentLocale(next);
}

export async function setLocale(next: string): Promise<void> {
  if (!isActiveLocale(next)) throw new Error('Unsupported locale');
  locale.value = next;
  applyDocumentLocale(next);
  await saveLocale(next);
}

export function usePanelI18n() {
  return { locale: readonly(locale), t, setLocale };
}
