import { describe, expect, it } from 'vitest';

import { t, type MessageKey } from '../../src/sidepanel/i18n';

const KEYS: MessageKey[] = [
  'description',
  'control',
  'settings',
  'debug',
  'openGrok',
  'notOnGrok',
  'pageChecked',
  'siteChanged',
  'tipTitle',
];

describe('side-panel copy', () => {
  it('has a non-empty English string for every key', () => {
    for (const key of KEYS) expect(t(key).trim()).not.toBe('');
  });

  it('carries none of the old product names', () => {
    const copy = KEYS.map(t).join('\n');
    expect(copy).not.toMatch(/paks|grok automator|sellify|chris\.dev/i);
  });
});
