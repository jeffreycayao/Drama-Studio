import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const defaultPlatformApiOrigin = 'https://paks-tools.vercel.app';

function parseApiOrigin(rawOrigin: string | undefined, development: boolean) {
  if (rawOrigin === undefined || rawOrigin.trim().length === 0) return null;
  try {
    const url = new URL(rawOrigin);
    const octets = url.hostname.split('.').map(Number);
    const isPrivateIpv4 =
      octets.length === 4 &&
      octets.every(
        (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
      ) &&
      (octets[0] === 10 ||
        (octets[0] === 172 &&
          octets[1] !== undefined &&
          octets[1] >= 16 &&
          octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168));
    const isDevelopmentHost =
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      isPrivateIpv4;
    const isOriginOnly =
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';

    if (
      isOriginOnly &&
      (url.protocol === 'https:' ||
        (development && url.protocol === 'http:' && isDevelopmentHost))
    ) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

function createSecurityHeaders(apiOrigin: string | null, development: boolean) {
  const connectSource = `connect-src 'self'${apiOrigin === null ? '' : ` ${apiOrigin}`}${development ? ' ws:' : ''}`;
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ''}; style-src 'self'${development ? " 'unsafe-inline'" : ''}; font-src 'self'; img-src 'self' data:; ${connectSource}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const configuredOrigin =
    environment.VITE_PLATFORM_API_ORIGIN ??
    environment.VITE_AUTH_API_ORIGIN ??
    defaultPlatformApiOrigin;
  const developmentOrigin = parseApiOrigin(configuredOrigin, true);
  const productionOrigin = parseApiOrigin(configuredOrigin, false);
  const developmentProxyTarget = parseApiOrigin(
    environment.PLATFORM_DEV_API_TARGET ?? 'http://127.0.0.1:8787',
    true,
  );

  if (developmentProxyTarget === null) {
    throw new Error(
      'PLATFORM_DEV_API_TARGET must be an exact HTTPS, loopback, or RFC1918 origin.',
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      headers: createSecurityHeaders(developmentOrigin, true),
      proxy: {
        '/health': {
          target: developmentProxyTarget,
          changeOrigin: true,
        },
        '/v1': {
          target: developmentProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      headers: createSecurityHeaders(productionOrigin, false),
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      minify: 'terser',
      cssMinify: true,
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
        },
        mangle: true,
        format: {
          comments: false,
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/zod/')) return 'validation-vendor';
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router')
            ) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
  };
});
