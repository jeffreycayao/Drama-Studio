import {
  isoDateTimeSchema,
  opaqueIdSchema,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod';

import { constantTimeEqual, createPrivacyKey } from '../core/crypto.js';
import { HttpError } from '../core/errors.js';
import type { AuditCursor } from '../ports/database.js';

export const auditCursorSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Invalid audit cursor');

export function encodeAuditCursor(cursor: AuditCursor, pepper: string): string {
  const payload = Buffer.from(
    `${cursor.createdAt}\0${cursor.id}`,
    'utf8',
  ).toString('base64url');
  const signature = createPrivacyKey(pepper, 'audit-cursor', [payload]);
  return `${payload}_${signature}`;
}

export function decodeAuditCursor(value: string, pepper: string): AuditCursor {
  const parsed = auditCursorSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(422, 'validation_failed', 'Audit cursor is invalid');
  }
  const separator = value.lastIndexOf('_');
  if (separator <= 0) {
    throw new HttpError(422, 'validation_failed', 'Audit cursor is invalid');
  }
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createPrivacyKey(pepper, 'audit-cursor', [payload]);
  if (!constantTimeEqual(signature, expected)) {
    throw new HttpError(422, 'validation_failed', 'Audit cursor is invalid');
  }
  let raw: string;
  try {
    raw = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    throw new HttpError(422, 'validation_failed', 'Audit cursor is invalid');
  }
  const separatorIndex = raw.indexOf('\0');
  const createdAt = isoDateTimeSchema.safeParse(raw.slice(0, separatorIndex));
  const id = opaqueIdSchema.safeParse(raw.slice(separatorIndex + 1));
  if (separatorIndex <= 0 || !createdAt.success || !id.success) {
    throw new HttpError(422, 'validation_failed', 'Audit cursor is invalid');
  }
  return { createdAt: createdAt.data, id: id.data };
}
