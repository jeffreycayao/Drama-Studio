import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain JavaScript build helper without type declarations
import { extensionIdFromPublicKey } from '../../scripts/lib/extension-identity.mjs';
import STORE_IDENTITY from '../../store/identity.json';
import config, { companionManifest, EXTENSION_NAME } from '../../wxt.config';

type Manifest = {
  name: string;
  action: { default_title: string };
  permissions: string[];
  optional_permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  content_security_policy: { extension_pages: string };
};

// The Store package: `wxt build` / `wxt zip`.
const manifest = companionManifest({
  mode: 'production',
  command: 'build',
}) as unknown as Manifest;

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

  it('asks for the other AI sites result hosts only when they are used', () => {
    expect(manifest.optional_host_permissions.sort()).toEqual(
      [
        'https://*.cdn-luma.com/*',
        'https://*.googleusercontent.com/*',
        'https://*.hailuoai.com/*',
        'https://*.hailuoai.video/*',
        'https://*.ideogram.ai/*',
        'https://*.kling.ai/*',
        'https://*.klingai.com/*',
        'https://*.leonardo.ai/*',
        'https://*.lumalabs.ai/*',
        'https://*.oaiusercontent.com/*',
        'https://*.pika.art/*',
        'https://*.runwayml.cloud/*',
        'https://*.runwayml.com/*',
        'https://cdn.leonardo.ai/*',
        'https://cdn.midjourney.com/*',
        'https://chatgpt.com/*',
        'https://hailuoai.video/*',
        'https://ideogram.ai/*',
        'https://flow.google.com/*',
        'https://labs.google/*',
        'https://pika.art/*',
        'https://storage.googleapis.com/*',
        'https://*.suno.ai/*',
        'https://*.suno.com/*',
        'https://suno.com/*',
      ].sort(),
    );
    for (const pattern of manifest.optional_host_permissions) {
      expect(pattern).toMatch(/^https:\/\/(?:\*\.)?[a-z0-9.-]+\/\*$/);
      expect(pattern).not.toBe('https://*/*');
    }
  });

  it('fits the Chrome Web Store limits for name and description', () => {
    const description = (manifest as unknown as { description: string })
      .description;
    expect(manifest.name.length).toBeLessThanOrEqual(75);
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(132);
  });

  it('keeps a strict extension-page CSP with no remote code', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-(?:eval|inline)|https?:/);
  });

  it('uses the manifest builder as the WXT manifest', () => {
    expect(config.manifest).toBe(companionManifest);
  });
});

describe('Companion Store identity', () => {
  it('derives the Store extension ID from the Store public key', () => {
    expect(STORE_IDENTITY.extensionId).toMatch(/^[a-p]{32}$/);
    expect(extensionIdFromPublicKey(STORE_IDENTITY.publicKey)).toBe(
      STORE_IDENTITY.extensionId,
    );
    expect(STORE_IDENTITY.storeUrl).toBe(
      `https://chromewebstore.google.com/detail/${STORE_IDENTITY.extensionId}`,
    );
  });

  it('keeps the key out of the Store package', () => {
    expect(manifest).not.toHaveProperty('key');
    expect(
      companionManifest({ mode: 'production', command: 'zip' }),
    ).not.toHaveProperty('key');
  });

  it('gives development and unpacked builds the Store ID', () => {
    for (const env of [
      { mode: 'development', command: 'serve' },
      { mode: 'unpacked', command: 'build' },
    ]) {
      expect(companionManifest(env)).toMatchObject({
        key: STORE_IDENTITY.publicKey,
      });
    }
  });
});
