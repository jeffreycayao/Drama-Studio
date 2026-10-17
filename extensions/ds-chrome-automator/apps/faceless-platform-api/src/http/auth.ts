import { accessTokenSchema } from '@faceless-automations/platform-contracts';

import { parseAdminConfig, parseSessionConfig } from '../config/env.js';
import {
  constantTimeEqual,
  createCsrfToken,
  hashSessionToken,
} from '../core/crypto.js';
import { HttpError } from '../core/errors.js';
import type {
  AppSessionRecord,
  AuthenticatedSession,
  DatabasePort,
} from '../ports/database.js';
import { parseCookies } from './request.js';

export const SESSION_COOKIE_NAME = '__Host-fa_session';
export const OAUTH_COOKIE_NAME = '__Host-fa_oauth_state';

function readToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
    if (match === null) return null;
    return match[1] ?? null;
  }
  return (
    parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE_NAME) ?? null
  );
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  const match =
    authorization === null
      ? null
      : /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
  return match?.[1] ?? null;
}

export async function requireSession(input: {
  database: DatabasePort;
  environment: NodeJS.ProcessEnv;
  now: string;
  request: Request;
}): Promise<AuthenticatedSession> {
  const token = readToken(input.request);
  const parsed = accessTokenSchema.safeParse(token);
  if (!parsed.success) {
    throw new HttpError(401, 'unauthorized', 'Authentication is required');
  }
  const { tokenPepper } = parseSessionConfig(input.environment);
  const session = await input.database.getSessionByTokenHash(
    hashSessionToken(parsed.data, tokenPepper),
    input.now,
  );
  if (session === null) {
    throw new HttpError(401, 'unauthorized', 'Authentication is required');
  }
  if (session.status === 'banned') {
    throw new HttpError(403, 'forbidden', 'Account access is unavailable');
  }
  return session;
}

export async function requireAdmin(input: {
  database: DatabasePort;
  environment: NodeJS.ProcessEnv;
  now: string;
  request: Request;
}): Promise<AuthenticatedSession> {
  const session = await requireSession(input);
  if (!(await isAdminSession({ ...input, session }))) {
    throw new HttpError(403, 'forbidden', 'Administrator access is required');
  }
  return session;
}

export async function isAdminSession(input: {
  database: DatabasePort;
  environment: NodeJS.ProcessEnv;
  session: AuthenticatedSession;
}): Promise<boolean> {
  const { googleSubjects } = parseAdminConfig(input.environment);
  const configuredSubject = googleSubjects.some((subject) =>
    constantTimeEqual(subject, input.session.googleSubject),
  );
  if (configuredSubject) return true;
  return input.database.isAdminIdentity({
    subject: input.session.googleSubject,
    userId: input.session.userId,
  });
}

export async function requireAppSession(input: {
  appId: string;
  database: DatabasePort;
  environment: NodeJS.ProcessEnv;
  now: string;
  origin: string;
  request: Request;
}): Promise<AppSessionRecord> {
  const parsed = accessTokenSchema.safeParse(readBearerToken(input.request));
  if (!parsed.success) {
    throw new HttpError(
      401,
      'unauthorized',
      'Application authentication is required',
    );
  }
  const { tokenPepper } = parseSessionConfig(input.environment);
  const session = await input.database.getAppSessionByTokenHash(
    hashSessionToken(parsed.data, tokenPepper),
    input.now,
  );
  if (
    session?.appId !== input.appId ||
    session.extensionOrigin !== input.origin
  ) {
    throw new HttpError(
      401,
      'unauthorized',
      'Application authentication is required',
    );
  }
  if (session.status === 'banned') {
    throw new HttpError(403, 'forbidden', 'Account access is unavailable');
  }
  return session;
}

export function getCsrfToken(
  session: AuthenticatedSession,
  environment: NodeJS.ProcessEnv,
): string {
  const { tokenPepper } = parseSessionConfig(environment);
  return createCsrfToken(session.sessionId, tokenPepper);
}

export function requireCsrf(input: {
  environment: NodeJS.ProcessEnv;
  request: Request;
  session: AuthenticatedSession;
}): void {
  const supplied = input.request.headers.get('x-faceless-csrf');
  const expected = getCsrfToken(input.session, input.environment);
  if (supplied === null || !constantTimeEqual(supplied, expected)) {
    throw new HttpError(403, 'forbidden', 'CSRF validation failed');
  }
}

export function createSecureCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearSecureCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
