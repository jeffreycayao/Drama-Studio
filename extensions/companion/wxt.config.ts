import { defineConfig } from 'wxt';

import { GROK_HOST_PERMISSIONS } from './src/sites/grok';

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
    description:
      'Works with the Drama Studio desktop app: fills long prompts into AI sites and runs Grok Imagine batches that stop at any limit.',
    action: {
      default_title: EXTENSION_NAME,
      default_icon: ICONS,
    },
    permissions: ['storage', 'tabs', 'downloads'],
    // The desktop link (plan §4) is opt-in: the side panel asks for it when
    // the user connects to Drama Studio.
    optional_permissions: ['nativeMessaging'],
    host_permissions: [...GROK_HOST_PERMISSIONS],
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
