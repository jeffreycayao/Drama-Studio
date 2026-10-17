import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export const vercelCliVersion = '50.39.0';
export const vercelOrgId = 'team_8bOGJgNqmfKYV3jeay0uq8OO';

const apiSecurityHeaders = [
  {
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ],
  },
];

const dashboardSecurityHeaders = [
  {
    source: '/(.*)',
    headers: [
      {
        key: 'Content-Security-Policy',
        value:
          "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ],
  },
];

export const vercelSurfaces = Object.freeze({
  dashboard: Object.freeze({
    id: 'dashboard',
    projectId: 'prj_2bs4lFlzvcrOhVP1HOpLUywdkTS7',
    projectName: 'paks-tools',
    stableOrigin: 'https://paks-tools.vercel.app',
    canonicalConfig: 'vercel.dashboard.json',
    expectedFunctions: Object.freeze([]),
    expectedConfig: Object.freeze({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      installCommand: 'npm ci',
      buildCommand: 'npm run build:dashboard && npm run verify:build:dashboard',
      outputDirectory: 'apps/faceless-automation-dashboard/dist',
      rewrites: [
        {
          source: '/v1/:path*',
          destination: 'https://paks-api.vercel.app/v1/:path*',
        },
        {
          source: '/health/:path*',
          destination: 'https://paks-api.vercel.app/health/:path*',
        },
        { source: '/(.*)', destination: '/index.html' },
      ],
      headers: dashboardSecurityHeaders,
    }),
  }),
  api: Object.freeze({
    id: 'api',
    projectId: 'prj_xJn4iaI7u6pDQnzhFxBuFbVI4W8V',
    projectName: 'paks-api',
    stableOrigin: 'https://paks-api.vercel.app',
    canonicalConfig: 'vercel.api.json',
    expectedFunctions: Object.freeze(['api/index']),
    expectedConfig: Object.freeze({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      installCommand: 'npm ci',
      buildCommand:
        'npm run build:contracts && npm run verify:build:contracts && npm run build:api && npm run verify:build:api',
      outputDirectory: 'apps/faceless-platform-api/public',
      functions: {
        'api/index.ts': {
          maxDuration: 30,
        },
      },
      crons: [
        {
          path: '/v1/internal/migrations',
          schedule: '0 4 * * *',
        },
      ],
      rewrites: [
        { source: '/health/:path*', destination: '/api/index' },
        { source: '/v1/:path*', destination: '/api/index' },
      ],
      headers: apiSecurityHeaders,
    }),
  }),
});

export function getVercelSurface(surfaceName) {
  const surface = vercelSurfaces[surfaceName];
  if (surface === undefined) {
    throw new Error(
      `Unknown surface ${JSON.stringify(surfaceName)}. Expected dashboard or api.`,
    );
  }
  return surface;
}
