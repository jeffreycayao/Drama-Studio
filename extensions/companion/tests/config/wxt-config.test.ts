import { describe, expect, it } from 'vitest';

import config, { EXTENSION_NAME } from '../../wxt.config';

type Manifest = {
  name: string;
  action: { default_title: string };
  permissions: string[];
  optional_permissions: string[];
  host_permissions: string[];
  content_security_policy: { extension_pages: string };
};

const manifest = config.manifest as unknown as Manifest;

describe('Companion manifest', () => {
  it('carries the Drama Studio name on the brand surfaces', () => {
    expect(EXTENSION_NAME).toBe('Drama Studio™ Companion');
    expect(manifest.name).toBe(EXTENSION_NAME);
    expect(manifest.action.default_title).toBe(EXTENSION_NAME);
    expect(JSON.stringify(manifest)).not.toMatch(
      /paks|grok automator|sellify|chris\.dev/i,
    );
  });

  it('asks only for the permissions the features use', () => {
    expect(manifest.permissions.sort()).toEqual([
      'contextMenus',
      'downloads',
      'storage',
      'tabs',
    ]);
    // The desktop link is requested when the person connects, not at install.
    expect(manifest.optional_permissions).toEqual(['nativeMessaging']);
    expect(manifest.host_permissions.sort()).toEqual([
      'https://*.grok.com/*',
      'https://grok.com/*',
      'https://imgen.x.ai/*',
      'https://vidgen.x.ai/*',
    ]);
  });

  it('keeps a strict extension-page CSP with no remote code', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-(?:eval|inline)|https?:/);
  });
});
