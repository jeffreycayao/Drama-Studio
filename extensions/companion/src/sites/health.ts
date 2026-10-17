import type { SiteAdapter } from './types';

export interface SiteHealth {
  ok: boolean;
  /** Selector keys of each requirement that matched nothing. */
  missing: string[];
  revision: string;
}

/**
 * Checks that every health requirement of an adapter finds at least one
 * element. `count` runs a selector in the adapter's dialect and returns how
 * many elements matched.
 */
export function checkSiteHealth<TSelectors extends Record<string, string>>(
  adapter: SiteAdapter<TSelectors>,
  count: (selector: string) => number,
): SiteHealth {
  const missing: string[] = [];
  for (const requirement of adapter.health) {
    const satisfied = requirement.some((key) => {
      const selector = adapter.selectors[key];
      if (!selector) return false;
      try {
        return count(selector) > 0;
      } catch {
        return false;
      }
    });
    if (!satisfied) missing.push(requirement.join(' | '));
  }
  return { ok: missing.length === 0, missing, revision: adapter.revision };
}
