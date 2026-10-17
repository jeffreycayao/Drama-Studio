import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createPlatformApp } from '../src/http/app.js';
import { readBoundedNodeRequest } from '../src/http/node-request.js';
import { TRUSTED_CLIENT_ADDRESS_HEADER } from '../src/http/rate-limit.js';

const app = createPlatformApp();

function copyResponseHeaders(response: Response, target: ServerResponse): void {
  const getSetCookie = response.headers.getSetCookie.bind(response.headers);
  for (const [name, value] of response.headers.entries()) {
    if (name.toLowerCase() !== 'set-cookie') target.setHeader(name, value);
  }
  const cookies = getSetCookie();
  if (cookies.length > 0) target.setHeader('Set-Cookie', cookies);
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
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
      )
        headers.append(name, value);
    }
    const clientAddress = request.socket.remoteAddress;
    if (clientAddress !== undefined) {
      headers.set(TRUSTED_CLIENT_ADDRESS_HEADER, clientAddress);
    }
    const url = new URL(request.url ?? '/', 'http://internal.invalid');
    const webRequest = new Request(url, {
      ...(body.length === 0 ? {} : { body: body.toString('utf8') }),
      headers,
      method: request.method ?? 'GET',
    });
    const webResponse = await app(webRequest);
    response.statusCode = webResponse.status;
    copyResponseHeaders(webResponse, response);
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch {
    const requestId = randomBytes(12).toString('base64url');
    response.statusCode = 413;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    response.end(
      JSON.stringify({
        error: {
          code: 'bad_request',
          message: 'Request rejected',
          requestId,
        },
      }),
    );
  }
}
