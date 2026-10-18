import { defineConfig } from 'wxt';

import { AI_SITE_MEDIA_PATTERNS } from './src/sites/ai-sites';
import { GROK_HOST_PERMISSIONS } from './src/sites/grok';

// Result hosts of the other AI sites. Chrome asks the person for one the
// first time they send a picture or video from that site to Drama Studio.
export const OPTIONAL_HOST_PERMISSIONS = AI_SITE_MEDIA_PATTERNS.filter(
  (pattern) => !(GROK_HOST_PERMISSIONS as readonly string[]).includes(pattern),
);

export const EXTENSION_NAME = 'Drama Studio™ Companion';

const ICONS = {
  16: '/icon/16.png',
  32: '/icon/32.png',
  48: '/icon/48.png',
  128: '/icon/128.png',
};

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: EXTENSION_NAME,
    short_name: 'DS Companion',
    // The Chrome Web Store allows 132 characters (verify-production-build).
    description:
      'Companion for the Drama Studio desktop app: fills your prompts and references into AI sites and brings the results back.',
    action: {
      default_title: EXTENSION_NAME,
      default_icon: ICONS,
    },
    permissions: ['storage', 'tabs', 'downloads', 'contextMenus'],
    // The desktop link (plan §4) is opt-in: the side panel asks for it when
    // the user connects to Drama Studio.
    optional_permissions: ['nativeMessaging'],
    host_permissions: [...GROK_HOST_PERMISSIONS],
    optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
    icons: ICONS,
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; img-src 'self' data:;",
    },
  },
  vite: () => ({
    build: {
      sourcemap: false,
      cssMinify: 'esbuild',
    },
  }),
});
