import { describe, expect, it } from 'vitest';

import {
  ACTIVE_LOCALES,
  RECOVERED_LOCALES,
  applyDocumentLocale,
  isActiveLocale,
  resolveActiveLocale,
} from '../../src/sidepanel/i18n';

describe('side-panel locale handoff', () => {
  it('retains the recovered 20-locale contract while exposing only English', () => {
    expect(RECOVERED_LOCALES).toHaveLength(20);
    expect(RECOVERED_LOCALES).toContain('ar');
    expect(RECOVERED_LOCALES).toContain('bn');
    expect(RECOVERED_LOCALES).toContain('tl');
    expect(RECOVERED_LOCALES).toContain('ur');
    expect(RECOVERED_LOCALES).not.toContain('ms');
    expect(RECOVERED_LOCALES).not.toContain('pl');
    expect(ACTIVE_LOCALES).toEqual(['en']);
  });

  it('resolves previously stored untranslated locales to active English', () => {
    expect(resolveActiveLocale('en')).toBe('en');
    expect(resolveActiveLocale('ar')).toBe('en');
    expect(resolveActiveLocale('unknown')).toBe('en');
    expect(isActiveLocale('en')).toBe(true);
    expect(isActiveLocale('de')).toBe(false);
  });

  it.each([
    ['en', 'ltr'],
    ['de', 'ltr'],
    ['ar', 'rtl'],
    ['ur', 'rtl'],
  ] as const)(
    'applies %s document language and %s direction',
    (next, direction) => {
      const root = { lang: '', dir: '' };
      applyDocumentLocale(next, root);
      expect(root).toEqual({ lang: next, dir: direction });
    },
  );
});
