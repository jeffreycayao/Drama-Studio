import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';

import { createPlatformApp } from '../dist/src/http/app.js';
import { readBoundedNodeRequest } from '../dist/src/http/node-request.js';
import { TRUSTED_CLIENT_ADDRESS_HEADER } from '../dist/src/http/rate-limit.js';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const hostArgumentIndex = process.argv.indexOf('--host');
const argumentHost =
  hostArgumentIndex === -1 ? undefined : process.argv[hostArgumentIndex + 1];
const host = argumentHost ?? process.env.PLATFORM_DEV_HOST ?? '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0', 'localhost'].includes(host)) {
  throw new Error(
    'PLATFORM_DEV_HOST/--host must be 127.0.0.1, localhost, or explicit 0.0.0.0',
  );
}

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const first = octets[0];
  const second = octets[1];
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function defaultDevelopmentOrigins() {
  const origins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  if (host === '0.0.0.0') {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (
          address.family === 'IPv4' &&
          !address.internal &&
          isPrivateIpv4(address.address)
        ) {
          origins.add(`http://${address.address}:5173`);
        }
      }
    }
  }
  return [...origins].sort().join(',');
}

const currentWorkspaceDevelopmentRegistrations = JSON.stringify([
  {
    appId: 'grok-automator',
    origin: 'chrome-extension://gegefkobmeapidelleohofpcigokggci',
    environment: 'development',
  },
]);

const localPublicEnvironment = {
  ALLOW_LOCAL_DEVELOPMENT_ORIGINS: 'true',
  PUBLIC_API_ORIGIN: 'https://api-not-configured.invalid',
  PUBLIC_APP_ORIGIN: 'https://app-not-configured.invalid',
  PUBLIC_DEV_ORIGINS:
    process.env.PUBLIC_DEV_ORIGINS ?? defaultDevelopmentOrigins(),
  PUBLIC_EXTENSION_REGISTRATIONS_JSON:
    process.env.PUBLIC_EXTENSION_REGISTRATIONS_JSON ??
    currentWorkspaceDevelopmentRegistrations,
  PUBLIC_WEB_ORIGINS: 'https://app-not-configured.invalid',
};

const app = createPlatformApp({ environment: localPublicEnvironment });

createServer(async (request, response) => {
  try {
    const body = await readBoundedNodeRequest(request);
    const headers = new Headers();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (
        name !== undefined &&
        value !== undefined &&
        name.toLowerCase() !== TRUSTED_CLIENT_ADDRESS_HEADER
      ) {
        headers.append(name, value);
      }
    }
    if (request.socket.remoteAddress !== undefined) {
      headers.set(TRUSTED_CLIENT_ADDRESS_HEADER, request.socket.remoteAddress);
    }
    const webRequest = new Request(
      new URL(request.url ?? '/', `http://127.0.0.1:${port}`),
      {
        ...(body.length === 0 ? {} : { body }),
        headers,
        method: request.method ?? 'GET',
      },
    );
    const webResponse = await app(webRequest);
    response.statusCode = webResponse.status;
    for (const [name, value] of webResponse.headers.entries()) {
      response.setHeader(name, value);
    }
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch {
    response.statusCode = 413;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        error: {
          code: 'bad_request',
          message: 'Request rejected',
        },
      }),
    );
  }
}).listen(port, host, () => {
  process.stdout.write(
    `No-secret Paks Tools Faceless automations API shell listening on http://${host}:${port}\n`,
  );
});
