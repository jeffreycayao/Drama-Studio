import type { IncomingMessage, ServerResponse } from 'node:http';

// Vercel discovers serverless functions only from the project-root `api/`
// directory and currently compiles this adapter as CommonJS. Dynamic import is
// the supported bridge to the ESM workspace that owns the tested handler.
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { default: platformHandler } =
    await import('../apps/faceless-platform-api/api/index.js');
  await platformHandler(request, response);
}
