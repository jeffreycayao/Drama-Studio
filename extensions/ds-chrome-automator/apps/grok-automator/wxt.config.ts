import { defineConfig } from 'wxt';

import {
  configuredOriginOrDefault,
  DEPLOYED_PLATFORM_API_ORIGIN,
} from './src/config/deployment';
import { normalizeOwnedOrigin } from './src/config/origin-policy';

export function platformApiHostPermission(
  value: unknown,
  allowLocalDevelopment: boolean,
): string | null {
  const origin = normalizeOwnedOrigin(value, {
    allowInsecurePrivateDevelopment: allowLocalDevelopment,
  });
  if (!origin) return null;
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

const legalBanner = `/*!
 * COPYRIGHT (c) 2026 PAKS LLC. ALL RIGHTS RESERVED.
 * Taipei, Taiwan
 *
 * Official Channels:
 * - Facebook: https://www.facebook.com/sys0001x
 * - Instagram / X / TikTok: @sys0001x
 *
 * WARNING: PROTECTED BY INTERNATIONAL COPYRIGHT AND INTELLECTUAL PROPERTY LAWS.
 *
 * This extension bundle consists of strictly proprietary, classified, and
 * confidential software exclusively owned by PAKS LLC.
 *
 * ANY UNAUTHORIZED COPYING, DISTRIBUTION, REVERSE ENGINEERING, DECOMPILATION,
 * MODIFICATION, RESALE, SUBLICENSING, OR COMMERCIAL EXPLOITATION OF THIS SOFTWARE,
 * IN WHOLE OR IN PART, IS ABSOLUTELY PROHIBITED AND WILL BE PROSECUTED.
 *
 * VIOLATORS WILL BE HELD LIABLE TO THE FULLEST EXTENT OF THE LAW, INCLUDING
 * BUT NOT LIMITED TO SEVERE CIVIL DAMAGES, STATUTORY INJUNCTIONS, AND CRIMINAL
 * PENALTIES. WE ACTIVE MONITOR AND ENFORCE ALL INTELLECTUAL PROPERTY RIGHTS.
 */`;

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-vue'],
  manifest: ({ mode }) => {
    const platformApiPermission = platformApiHostPermission(
      configuredOriginOrDefault(
        process.env.WXT_PLATFORM_API_ORIGIN,
        DEPLOYED_PLATFORM_API_ORIGIN,
      ),
      mode !== 'production',
    );

    return {
      name: 'Grok Automator™',
      description:
        'Auto Grok your prompts at scale. Batch generate and auto-download videos and images on grok.com.',
      action: {
        default_title: 'Grok Automator™',
        default_icon: {
          16: '/icon/16.png',
          32: '/icon/32.png',
          48: '/icon/48.png',
          128: '/icon/128.png',
        },
      },
      permissions: ['storage', 'tabs', 'downloads'],
      host_permissions: [
        'https://grok.com/*',
        'https://*.grok.com/*',
        'https://imgen.x.ai/*',
        'https://vidgen.x.ai/*',
        ...(platformApiPermission ? [platformApiPermission] : []),
      ],
      offline_enabled: true,
      icons: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        128: '/icon/128.png',
      },
      content_security_policy: {
        extension_pages:
          "script-src 'self'; object-src 'self'; img-src 'self' data:;",
      },
    };
  },
  vite: () => ({
    build: {
      sourcemap: false,
      minify: 'terser',
      cssMinify: 'esbuild',
      rollupOptions: {
        output: {
          banner: legalBanner,
        },
      },
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
        },
        mangle: true,
        format: {
          comments: /^!/,
        },
      },
    },
  }),
});
