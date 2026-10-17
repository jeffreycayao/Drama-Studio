import type { z } from 'zod';

import { HttpError } from '../core/errors.js';

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  maximumBytes = 64 * 1_024,
): Promise<z.infer<TSchema>> {
  const contentType = request.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim();
  if (contentType !== 'application/json') {
    throw new HttpError(
      400,
      'bad_request',
      'Expected an application/json body',
    );
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new HttpError(413, 'bad_request', 'Request body is too large');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_request', 'Malformed JSON body');
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(422, 'validation_failed', 'Request validation failed');
  }
  return result.data;
}

export async function readRawBody(
  request: Request,
  maximumBytes = 1_024 * 1_024,
): Promise<string> {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new HttpError(413, 'bad_request', 'Request body is too large');
  }
  return text;
}

export function parseCookies(
  header: string | null,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  if (header === null) return values;
  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name.length > 0 && !values.has(name)) values.set(name, value);
  }
  return values;
}
