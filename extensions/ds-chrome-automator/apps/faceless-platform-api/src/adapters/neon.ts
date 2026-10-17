import { neon } from '@neondatabase/serverless';
import {
  guideAdminDocumentSchema,
  guideAdminSummarySchema,
  guideContentSchema,
  guidePublicDocumentSchema,
  usageReservationResponseSchema,
  type GuideAdminDocument,
  type GuideAdminSummary,
  type GuidePublicDocument,
} from '@faceless-automations/platform-contracts';
import { z } from 'zod';

import { parseDatabaseConfig } from '../config/env.js';
import type {
  AuthenticatedSession,
  AuditCursorPage,
  CursorPage,
  DatabasePort,
  GoogleOauthFlow,
  RateLimitBucket,
  UsageReservationTransition,
} from '../ports/database.js';
import {
  adminOverviewSchema,
  adminUserSchema,
  auditEventSchema,
  entitlementSchema,
  platformSettingsContentSchema,
  platformSettingsSchema,
  type AdminUser,
  type AuditEvent,
  type Entitlement,
  type PlatformSettings,
} from '../schemas/admin.js';

const dateTimeFromDatabaseSchema = z
  .union([z.string(), z.date()])
  .transform((value) =>
    typeof value === 'string'
      ? new Date(value).toISOString()
      : value.toISOString(),
  );

const sessionRowSchema = z.strictObject({
  display_name: z.string().nullable(),
  email: z.email(),
  expires_at: dateTimeFromDatabaseSchema,
  google_subject: z.string().min(1),
  session_id: z.string().min(16),
  status: z.enum(['active', 'banned']),
  user_id: z.string().min(16),
});

const adminIdentityResultSchema = z.strictObject({
  authorized: z.boolean(),
});

const guideRowSchema = z.strictObject({
  app_id: z.string(),
  content: z.unknown(),
  created_at: dateTimeFromDatabaseSchema,
  published_at: z.union([z.string(), z.date()]).nullable(),
  revision: z.coerce.number().int().nonnegative(),
  slug: z.string(),
  status: z.enum(['draft', 'published']),
  summary: z.string(),
  title: z.string(),
  updated_at: dateTimeFromDatabaseSchema,
  updated_by_display_name: z.string().nullable(),
  updated_by_user_id: z.string().nullable(),
});

const guideSummaryRowSchema = guideRowSchema.pick({
  app_id: true,
  published_at: true,
  revision: true,
  slug: true,
  status: true,
  summary: true,
  title: true,
  updated_at: true,
});

const oauthFlowRowSchema = z.strictObject({
  allocation_key: z.string().length(64),
  client: z.enum(['dashboard', 'extension']),
  encrypted_code_verifier: z.string().min(1),
  expires_at: dateTimeFromDatabaseSchema,
  extension_flow_id: z.string().nullable(),
  nonce_hash: z.string().length(64),
  state_hash: z.string().length(64),
});

const extensionFlowRowSchema = z.strictObject({
  allocation_key: z.string().length(64),
  app_id: z.string().min(3),
  code_challenge: z.string().length(43),
  expires_at: dateTimeFromDatabaseSchema,
  extension_origin: z.string().min(1),
  flow_id: z.string().min(16),
  initiator_verified_at: z.union([z.string(), z.date()]).nullable(),
  protocol_version: z.coerce
    .number()
    .pipe(z.union([z.literal(1), z.literal(2)])),
  status: z.enum(['pending', 'authorized', 'denied', 'consumed']),
  user_id: z.string().nullable(),
  user_code_hash: z.string().length(64),
  verification_attempts: z.coerce.number().int().min(0).max(5),
});

const extensionSessionGrantRowSchema = z.strictObject({
  display_name: z.string().nullable(),
  email: z.email(),
  plan_code: z.enum(['all-apps', 'free-plan', 'single-license']),
  user_id: z.string().min(16),
});

const appSessionRowSchema = z.strictObject({
  app_id: z.string().min(3),
  expires_at: dateTimeFromDatabaseSchema,
  extension_origin: z.string().min(1),
  session_id: z.string().min(16),
  status: z.enum(['active', 'banned']),
  user_id: z.string().min(16),
});

const usageDecisionRowSchema = z.strictObject({
  acceptance_expires_at: z.union([z.string(), z.date()]).nullable(),
  acceptance_id: z.string().nullable(),
  allowed: z.boolean(),
  authorization_id: z.string().min(16),
  authorized_units: z.coerce.number().int().min(1).max(1_000),
  denial_reason: z
    .enum([
      'entitlement_required',
      'quota_exhausted',
      'app_disabled',
      'operation_disabled',
    ])
    .nullable(),
  remaining_units: z.coerce.number().int().min(0),
  resets_at: dateTimeFromDatabaseSchema,
  expires_at: dateTimeFromDatabaseSchema,
  finalized_at: z.union([z.string(), z.date()]).nullable(),
  idempotency_matches: z.boolean(),
  lifecycle_status: z.enum([
    'reserved',
    'accepted',
    'consumed',
    'cancelled',
    'rolled_back',
    'denied',
    'expired',
  ]),
});

const usageTransitionRowSchema = z.strictObject({
  acceptance_expires_at: z.union([z.string(), z.date()]).nullable(),
  acceptance_id: z.string().nullable(),
  app_id: z.string().min(3),
  authorization_id: z.string().min(16),
  finalized_at: z.union([z.string(), z.date()]).nullable(),
  operation: z.string().min(3),
  lifecycle_status: z.enum([
    'accepted',
    'consumed',
    'cancelled',
    'rolled_back',
    'expired',
  ]),
});

const rateLimitResultSchema = z.strictObject({ allowed: z.boolean() });
const flowCreatedRowSchema = z.strictObject({ created: z.boolean() });
const verificationResultRowSchema = z.strictObject({
  attempts: z.coerce.number().int().min(0).max(5),
  verified: z.boolean(),
});
const extensionGoogleCallbackOutcomeRowSchema = z.strictObject({
  callback_status: z.enum(['bound', 'already_bound']),
  protocol_version: z.coerce
    .number()
    .pipe(z.union([z.literal(1), z.literal(2)])),
});

const platformSettingsRowSchema = z.strictObject({
  revision: z.coerce.number().int().nonnegative(),
  settings: z.unknown(),
  updated_at: dateTimeFromDatabaseSchema,
});

const adminUserRowSchema = z.strictObject({
  ban_reason: z.string().nullable(),
  banned_at: z.union([z.string(), z.date()]).nullable(),
  created_at: dateTimeFromDatabaseSchema,
  display_name: z.string().nullable(),
  email: z.email(),
  id: z.string().min(16),
  last_login_at: z.union([z.string(), z.date()]).nullable(),
  status: z.enum(['active', 'banned']),
});

const entitlementRowSchema = z.strictObject({
  code: z.string(),
  expires_at: z.union([z.string(), z.date()]).nullable(),
  granted_at: dateTimeFromDatabaseSchema,
  id: z.string().min(16),
  revoke_reason: z.string().nullable(),
  revoked_at: z.union([z.string(), z.date()]).nullable(),
  source: z.enum(['stripe', 'admin', 'migration']),
  status: z.enum(['active', 'revoked', 'expired']),
  user_email: z.email(),
  user_id: z.string().min(16),
});

const auditEventRowSchema = z.strictObject({
  action: z.string(),
  actor_user_id: z.string().min(16),
  created_at: dateTimeFromDatabaseSchema,
  id: z.string().min(16),
  reason: z.string().nullable(),
  target_id: z.string(),
  target_type: z.string(),
});

const overviewRowSchema = z.strictObject({
  active_entitlements: z.coerce.number().int().nonnegative(),
  active_users: z.coerce.number().int().nonnegative(),
  banned_users: z.coerce.number().int().nonnegative(),
  pending_stripe_events: z.coerce.number().int().nonnegative(),
  revoked_entitlements: z.coerce.number().int().nonnegative(),
  total_users: z.coerce.number().int().nonnegative(),
});

const booleanRowSchema = z.strictObject({ changed: z.boolean() });
const insertedRowSchema = z.strictObject({ inserted: z.boolean() });
const migrationVersionRowSchema = z.strictObject({ version: z.string() });

type CreateGoogleSessionInput = Parameters<
  DatabasePort['createGoogleSession']
>[0];

interface ParameterizedStatement {
  readonly parameters: readonly unknown[];
  readonly text: string;
}

type CreateExtensionFlowInput = Parameters<
  DatabasePort['createExtensionAuthFlow']
>[0];
type AuthorizeUsageInput = Parameters<DatabasePort['authorizeUsage']>[0];

export function buildConsumeRateLimitsTransaction(
  buckets: readonly RateLimitBucket[],
): readonly ParameterizedStatement[] {
  const distinct = [
    ...new Map(
      buckets.map((bucket) => [
        `${bucket.key}:${bucket.windowStartedAt}`,
        bucket,
      ]),
    ).values(),
  ];
  if (distinct.length === 0) return [];
  const lockStatements = distinct
    .map((bucket) => `${bucket.key}:${bucket.windowStartedAt}`)
    .sort()
    .map((lockKey) => ({
      parameters: [lockKey],
      text: 'SELECT pg_advisory_xact_lock(hashtext($1))',
    }));
  return [
    ...lockStatements,
    {
      parameters: [
        JSON.stringify(
          distinct.map((bucket) => ({
            bucket_key: bucket.key,
            expires_at: bucket.expiresAt,
            request_limit: bucket.limit,
            window_started_at: bucket.windowStartedAt,
          })),
        ),
      ],
      text: `WITH requested AS (
               SELECT *
                 FROM jsonb_to_recordset($1::jsonb) AS limits(
                   bucket_key text,
                   window_started_at timestamptz,
                   expires_at timestamptz,
                   request_limit integer
                 )
             ), capacity AS (
               SELECT NOT EXISTS (
                 SELECT 1
                   FROM requested requested_limit
                   JOIN rate_limit_buckets stored_limit
                     ON stored_limit.bucket_key = requested_limit.bucket_key
                    AND stored_limit.window_started_at =
                        requested_limit.window_started_at
                  WHERE stored_limit.request_count >= LEAST(
                          stored_limit.request_limit,
                          requested_limit.request_limit
                        )
               ) AS allowed
             ), consumed AS (
               INSERT INTO rate_limit_buckets
                 (bucket_key, window_started_at, request_count, request_limit,
                  expires_at, updated_at)
               SELECT bucket_key, window_started_at, 1, request_limit,
                      expires_at, NOW()
                 FROM requested, capacity
                WHERE capacity.allowed
               ON CONFLICT (bucket_key, window_started_at) DO UPDATE
                 SET request_count = rate_limit_buckets.request_count + 1,
                     request_limit = LEAST(
                       rate_limit_buckets.request_limit,
                       EXCLUDED.request_limit
                     ),
                     expires_at = GREATEST(
                       rate_limit_buckets.expires_at,
                       EXCLUDED.expires_at
                     ),
                     updated_at = NOW()
               RETURNING bucket_key, window_started_at
             )
             SELECT (SELECT COUNT(*) FROM consumed) =
                    (SELECT COUNT(*) FROM requested) AS allowed`,
    },
  ];
}

export function buildCreateGoogleOauthFlowTransaction(
  flow: GoogleOauthFlow,
  maximumConcurrentFlows: number,
): readonly ParameterizedStatement[] {
  return [
    {
      text: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      parameters: [flow.allocationKey],
    },
    {
      text: `WITH extension_scope AS MATERIALIZED (
               SELECT id
                 FROM extension_auth_flows
                WHERE id = $7
                  AND status = 'pending'
                  AND user_id IS NULL
                  AND expires_at > NOW()
                  FOR UPDATE
             ), inserted AS (
               INSERT INTO google_oauth_flows
                 (state_hash, nonce_hash, encrypted_code_verifier, expires_at,
                  client, extension_flow_id, allocation_key)
               SELECT $2, $3, $4, $5, $6, $7, $1
                WHERE ($7 IS NULL OR EXISTS (
                        SELECT 1 FROM extension_scope
                      ))
                  AND (
                  SELECT COUNT(*)
                    FROM google_oauth_flows
                   WHERE allocation_key = $1
                     AND (
                       ($7 IS NULL AND consumed_at IS NULL
                        AND expires_at > NOW())
                       OR $7 IS NOT NULL
                     )
                ) < $8
               RETURNING state_hash
             )
             SELECT EXISTS(SELECT 1 FROM inserted) AS created`,
      parameters: [
        flow.allocationKey,
        flow.stateHash,
        flow.nonceHash,
        flow.encryptedCodeVerifier,
        flow.expiresAt,
        flow.client,
        flow.extensionFlowId,
        maximumConcurrentFlows,
      ],
    },
  ];
}

export function buildDenyExtensionAuthFlowStatement(
  flowId: string,
  now: string,
): ParameterizedStatement {
  return {
    parameters: [flowId, now],
    text: `UPDATE extension_auth_flows
              SET status = 'denied', denied_at = $2
            WHERE id = $1
              AND status = 'pending'
              AND consumed_at IS NULL
              AND (
                protocol_version = 1
                OR (protocol_version = 2 AND user_id IS NULL)
              )`,
  };
}

export function buildCreateExtensionFlowTransaction(
  flow: CreateExtensionFlowInput,
  maximumConcurrentFlows: number,
): readonly ParameterizedStatement[] {
  return [
    {
      text: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      parameters: [flow.allocationKey],
    },
    {
      text: `WITH inserted AS (
               INSERT INTO extension_auth_flows
                 (id, app_id, extension_origin, code_challenge, status,
                  expires_at, allocation_key, user_code_hash,
                  verification_attempts, protocol_version)
               SELECT $2, $3, $4, $5, 'pending', $7, $1, $6, 0, $9
                WHERE (
                  SELECT COUNT(*)
                    FROM extension_auth_flows
                   WHERE allocation_key = $1
                     AND status IN ('pending', 'authorized')
                     AND expires_at > NOW()
                ) < $8
               RETURNING id
             )
             SELECT EXISTS(SELECT 1 FROM inserted) AS created`,
      parameters: [
        flow.allocationKey,
        flow.flowId,
        flow.appId,
        flow.extensionOrigin,
        flow.codeChallenge,
        flow.userCodeHash,
        flow.expiresAt,
        maximumConcurrentFlows,
        flow.protocolVersion,
      ],
    },
  ];
}

export function buildAuthorizeUsageTransaction(
  input: AuthorizeUsageInput,
): readonly ParameterizedStatement[] {
  return [
    {
      text: `SELECT pg_advisory_xact_lock(
               hashtext($1 || ':' || $2 || ':' || $3::timestamptz::text)
             )`,
      parameters: [input.userId, input.appId, input.resetsAt],
    },
    {
      text: `WITH session_scope AS (
               SELECT s.id
                 FROM app_sessions s
                 JOIN users u ON u.id = s.user_id
                WHERE s.id = $4
                  AND s.user_id = $1
                  AND s.app_id = $2
                  AND s.revoked_at IS NULL
                  AND s.expires_at > $3
                  AND u.status = 'active'
             ), entitlement_scope AS (
               SELECT EXISTS (
                 SELECT 1 FROM entitlements e, session_scope
                  WHERE e.user_id = $1
                    AND e.status = 'active'
                    AND (e.expires_at IS NULL OR e.expires_at > $3)
                    AND e.code IN ('extension:' || $2, 'bundle:all-extensions')
               ) AS entitled
             ), existing AS (
               SELECT ua.id AS authorization_id,
                      ua.allowed,
                      ua.units AS authorized_units,
                      ua.denial_reason,
                      ua.remaining_units,
                      ua.resets_at,
                      ua.expires_at,
                      ua.acceptance_id,
                      ua.acceptance_expires_at,
                      CASE
                        WHEN ua.lifecycle_status = 'reserved' AND ua.expires_at <= $3
                          THEN 'expired'
                        WHEN ua.lifecycle_status = 'accepted'
                         AND ua.acceptance_expires_at <= $3
                          THEN 'rolled_back'
                        ELSE ua.lifecycle_status
                      END AS lifecycle_status,
                      CASE
                        WHEN ua.lifecycle_status = 'consumed' THEN ua.consumed_at
                        WHEN ua.lifecycle_status = 'cancelled' THEN ua.cancelled_at
                        WHEN ua.lifecycle_status = 'rolled_back' THEN ua.rolled_back_at
                        WHEN ua.lifecycle_status = 'expired' THEN ua.expired_at
                        WHEN ua.lifecycle_status = 'reserved' AND ua.expires_at <= $3
                          THEN ua.expires_at
                        WHEN ua.lifecycle_status = 'accepted'
                         AND ua.acceptance_expires_at <= $3
                          THEN ua.acceptance_expires_at
                        ELSE NULL
                      END AS finalized_at,
                      ua.operation = $9 AND ua.units = $6
                        AND ua.protocol_version = $12 AS idempotency_matches
                 FROM usage_authorizations ua, session_scope
                WHERE ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.idempotency_key = $5
             ), usage_total AS (
               SELECT COALESCE(SUM(ua.units) FILTER (
                        WHERE ua.lifecycle_status = 'consumed'
                           OR (
                             ua.lifecycle_status = 'reserved'
                             AND ua.expires_at > $3
                           )
                           OR (
                             ua.lifecycle_status = 'accepted'
                             AND ua.acceptance_expires_at > $3
                           )
                      ), 0)::int AS used
                 FROM usage_authorizations ua, session_scope
                WHERE ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.created_at >= $10::timestamptz - INTERVAL '1 day'
                  AND ua.created_at < $10::timestamptz
             ), decision AS (
               SELECT entitlement_scope.entitled, usage_total.used,
                      entitlement_scope.entitled
                        AND usage_total.used + $6 <= $7 AS allowed
                 FROM entitlement_scope, usage_total
                WHERE EXISTS (SELECT 1 FROM session_scope)
                  AND NOT EXISTS (SELECT 1 FROM existing)
             ), inserted AS (
               INSERT INTO usage_authorizations
                 (id, app_session_id, user_id, app_id, operation, units,
                  idempotency_key, allowed, denial_reason, remaining_units,
                  resets_at, created_at, expires_at, lifecycle_status,
                  protocol_version)
               SELECT $8, $4, $1, $2, $9, $6, $5, decision.allowed,
                      CASE
                        WHEN NOT decision.entitled THEN 'entitlement_required'
                        WHEN NOT decision.allowed THEN 'quota_exhausted'
                        ELSE NULL
                      END,
                      GREATEST(
                        $7 - decision.used - CASE WHEN decision.allowed THEN $6 ELSE 0 END,
                        0
                      ),
                      $10, $3, $11,
                      CASE WHEN decision.allowed THEN 'reserved' ELSE 'denied' END,
                      $12
                 FROM decision
               ON CONFLICT (user_id, app_id, idempotency_key) DO NOTHING
               RETURNING id AS authorization_id, allowed,
                         units AS authorized_units, denial_reason,
                         remaining_units, resets_at, expires_at,
                         NULL::text AS acceptance_id,
                         NULL::timestamptz AS acceptance_expires_at,
                         lifecycle_status, NULL::timestamptz AS finalized_at,
                         TRUE AS idempotency_matches
             ), selected AS (
               SELECT * FROM existing
               UNION ALL
               SELECT * FROM inserted
               LIMIT 1
             )
             SELECT * FROM selected`,
      parameters: [
        input.userId,
        input.appId,
        input.now,
        input.appSessionId,
        input.idempotencyKey,
        input.units,
        input.dailyUnitLimit,
        input.authorizationId,
        input.operation,
        input.resetsAt,
        input.authorizationExpiresAt,
        input.protocolVersion,
      ],
    },
  ];
}

export function buildListAuditEventsStatement(input: {
  cursor?: { readonly createdAt: string; readonly id: string };
  limit: number;
}): ParameterizedStatement {
  return {
    text: `SELECT id, actor_user_id, action, target_type, target_id, reason, created_at
             FROM admin_audit_log
            WHERE (
              $1::timestamptz IS NULL OR
              (created_at, id) < ($1::timestamptz, $2::text)
            )
            ORDER BY created_at DESC, id DESC
            LIMIT $3`,
    parameters: [
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  };
}

export function buildCreateGoogleSessionTransaction(
  input: CreateGoogleSessionInput,
): readonly ParameterizedStatement[] {
  return [
    {
      text: `INSERT INTO users
               (id, email, display_name, last_login_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
      parameters: [
        input.newUserId,
        input.identity.email,
        input.identity.displayName,
      ],
    },
    {
      text: `INSERT INTO google_identities
               (issuer, subject, user_id, email, display_name, last_login_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (issuer, subject) DO UPDATE
                 SET email = EXCLUDED.email,
                     display_name = EXCLUDED.display_name,
                     last_login_at = NOW()`,
      parameters: [
        input.identity.issuer,
        input.identity.subject,
        input.newUserId,
        input.identity.email,
        input.identity.displayName,
      ],
    },
    {
      text: `DELETE FROM users
              WHERE id = $1
                AND NOT EXISTS (
                  SELECT 1
                    FROM google_identities
                   WHERE issuer = $2
                     AND subject = $3
                     AND user_id = $1
                )`,
      parameters: [
        input.newUserId,
        input.identity.issuer,
        input.identity.subject,
      ],
    },
    {
      text: `UPDATE users
                SET email = $1,
                    display_name = $2,
                    last_login_at = NOW(),
                    updated_at = NOW()
              WHERE id = (
                SELECT user_id
                  FROM google_identities
                 WHERE issuer = $3 AND subject = $4
              )`,
      parameters: [
        input.identity.email,
        input.identity.displayName,
        input.identity.issuer,
        input.identity.subject,
      ],
    },
    {
      text: `INSERT INTO web_sessions (id, user_id, token_hash, expires_at)
             SELECT $1, user_id, $2, $3
               FROM google_identities
              WHERE issuer = $4 AND subject = $5`,
      parameters: [
        input.sessionId,
        input.tokenHash,
        input.expiresAt,
        input.identity.issuer,
        input.identity.subject,
      ],
    },
    {
      text: `SELECT s.id AS session_id,
                    s.user_id,
                    s.expires_at,
                    u.email,
                    u.display_name,
                    u.status,
                    gi.subject AS google_subject
               FROM web_sessions s
               JOIN users u ON u.id = s.user_id
               JOIN google_identities gi
                 ON gi.user_id = u.id
                AND gi.issuer = $1
                AND gi.subject = $2
              WHERE s.id = $3`,
      parameters: [
        input.identity.issuer,
        input.identity.subject,
        input.sessionId,
      ],
    },
  ];
}

export function buildClaimAdminIdentityTransaction(input: {
  auditId: string;
  auditTargetId: string;
  email: string;
  issuer: string;
  now: string;
  subject: string;
  userId: string;
}): readonly ParameterizedStatement[] {
  return [
    {
      parameters: [input.email],
      text: `SELECT pg_advisory_xact_lock(hashtext('admin-bootstrap:' || $1))`,
    },
    {
      parameters: [
        input.issuer,
        input.subject,
        input.userId,
        input.email,
        input.now,
        input.auditId,
        input.auditTargetId,
      ],
      text: `WITH identity_scope AS MATERIALIZED (
               SELECT gi.issuer, gi.subject, gi.user_id
                 FROM google_identities gi
                 JOIN users u ON u.id = gi.user_id
                WHERE gi.issuer = $1
                  AND gi.subject = $2
                  AND gi.user_id = $3
                  AND LOWER(gi.email) = $4
                  AND LOWER(u.email) = $4
                  AND u.status = 'active'
                FOR UPDATE
             ), inserted AS (
               INSERT INTO admin_identities
                 (issuer, subject, user_id, normalized_email, created_at)
               SELECT issuer, subject, user_id, $4, $5
                 FROM identity_scope
               ON CONFLICT DO NOTHING
               RETURNING issuer, subject, user_id
             ), audited AS (
               INSERT INTO admin_audit_log
                 (id, actor_user_id, action, target_type, target_id, created_at)
               SELECT $6, user_id, 'admin.identity.bootstrap',
                      'admin_identity', $7, $5
                 FROM inserted
             )
             SELECT (
               EXISTS(
                 SELECT 1 FROM inserted
                  WHERE issuer = $1 AND subject = $2 AND user_id = $3
               ) OR EXISTS(
                 SELECT 1 FROM admin_identities
                  WHERE issuer = $1 AND subject = $2 AND user_id = $3
                    AND normalized_email = $4
               )
             ) AS authorized`,
    },
  ];
}

function optionalDate(value: string | Date | null): string | null {
  if (value === null) return null;
  return typeof value === 'string'
    ? new Date(value).toISOString()
    : value.toISOString();
}

function mapSession(
  row: z.infer<typeof sessionRowSchema>,
): AuthenticatedSession {
  return {
    displayName: row.display_name,
    email: row.email,
    expiresAt: row.expires_at,
    googleSubject: row.google_subject,
    sessionId: row.session_id,
    status: row.status,
    userId: row.user_id,
  };
}

function mapAdminGuide(
  row: z.infer<typeof guideRowSchema>,
): GuideAdminDocument {
  return guideAdminDocumentSchema.parse({
    appId: row.app_id,
    content: guideContentSchema.parse(row.content),
    createdAt: row.created_at,
    publishedAt: optionalDate(row.published_at),
    revision: String(row.revision),
    schemaVersion: 1,
    slug: row.slug,
    status: row.status,
    summary: row.summary,
    title: row.title,
    updatedAt: row.updated_at,
    updatedBy:
      row.updated_by_user_id === null
        ? null
        : {
            displayName: row.updated_by_display_name,
            userId: row.updated_by_user_id,
          },
  });
}

function mapPublishedGuide(
  row: z.infer<typeof guideRowSchema>,
): GuidePublicDocument {
  const guide = mapAdminGuide(row);
  if (guide.status !== 'published' || guide.publishedAt === null) {
    throw new Error('Published guide state is inconsistent');
  }
  return guidePublicDocumentSchema.parse({
    appId: guide.appId,
    content: guide.content,
    createdAt: guide.createdAt,
    publishedAt: guide.publishedAt,
    revision: guide.revision,
    schemaVersion: 1,
    slug: guide.slug,
    summary: guide.summary,
    title: guide.title,
    updatedAt: guide.updatedAt,
  });
}

const guideSelection = `SELECT g.slug, g.app_id, g.title, g.summary, g.status,
                               g.content, g.revision, g.created_at,
                               g.updated_at, g.published_at,
                               g.updated_by AS updated_by_user_id,
                               u.display_name AS updated_by_display_name
                          FROM tool_guides g
                          LEFT JOIN users u ON u.id = g.updated_by`;

function mapSettings(
  row: z.infer<typeof platformSettingsRowSchema>,
): PlatformSettings {
  const content = platformSettingsContentSchema.parse(row.settings);
  return platformSettingsSchema.parse({
    revision: String(row.revision),
    schemaVersion: 1,
    updatedAt: row.updated_at,
    ...content,
  });
}

function mapUser(row: z.infer<typeof adminUserRowSchema>): AdminUser {
  return adminUserSchema.parse({
    banReason: row.ban_reason,
    bannedAt: optionalDate(row.banned_at),
    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    lastLoginAt: optionalDate(row.last_login_at),
    status: row.status,
  });
}

function mapEntitlement(
  row: z.infer<typeof entitlementRowSchema>,
): Entitlement {
  return entitlementSchema.parse({
    code: row.code,
    expiresAt: optionalDate(row.expires_at),
    grantedAt: row.granted_at,
    id: row.id,
    revokeReason: row.revoke_reason,
    revokedAt: optionalDate(row.revoked_at),
    source: row.source,
    status: row.status,
    userEmail: row.user_email,
    userId: row.user_id,
  });
}

function mapAuditEvent(row: z.infer<typeof auditEventRowSchema>): AuditEvent {
  return auditEventSchema.parse({
    action: row.action,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    id: row.id,
    reason: row.reason,
    targetId: row.target_id,
    targetType: row.target_type,
  });
}

function page<T extends { readonly id: string }>(
  items: readonly T[],
  limit: number,
): CursorPage<T> {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  const lastVisible = visible[visible.length - 1];
  return {
    items: visible,
    nextCursor: hasMore ? (lastVisible?.id ?? null) : null,
  };
}

function auditPage(
  items: readonly AuditEvent[],
  limit: number,
): AuditCursorPage {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  const lastVisible = visible[visible.length - 1];
  return {
    items: visible,
    nextCursor:
      hasMore && lastVisible !== undefined
        ? { createdAt: lastVisible.createdAt, id: lastVisible.id }
        : null,
  };
}

function mapUsageReservation(
  row: z.infer<typeof usageDecisionRowSchema>,
  appId: string,
  operation: string,
) {
  const common = {
    appId,
    operation,
    authorizationId: row.authorization_id,
    authorizedUnits: row.authorized_units,
    remainingUnits: row.remaining_units,
    resetsAt: row.resets_at,
    schemaVersion: 2 as const,
  };
  if (row.lifecycle_status === 'reserved') {
    return usageReservationResponseSchema.parse({
      ...common,
      allowed: true,
      expiresAt: row.expires_at,
      status: 'reserved',
    });
  }
  if (row.lifecycle_status === 'consumed') {
    return usageReservationResponseSchema.parse({
      ...common,
      allowed: true,
      finalizedAt: row.finalized_at,
      status: 'consumed',
    });
  }
  if (row.lifecycle_status === 'accepted') {
    return usageReservationResponseSchema.parse({
      ...common,
      acceptanceId: row.acceptance_id,
      allowed: true,
      finalizeBy: optionalDate(row.acceptance_expires_at),
      status: 'accepted',
    });
  }
  if (row.lifecycle_status === 'cancelled') {
    return usageReservationResponseSchema.parse({
      ...common,
      allowed: false,
      finalizedAt: row.finalized_at,
      reason: 'reservation_cancelled',
      status: 'cancelled',
    });
  }
  if (row.lifecycle_status === 'expired') {
    return usageReservationResponseSchema.parse({
      ...common,
      allowed: false,
      finalizedAt: row.finalized_at,
      reason: 'reservation_expired',
      status: 'expired',
    });
  }
  if (row.lifecycle_status === 'rolled_back') {
    return usageReservationResponseSchema.parse({
      ...common,
      allowed: false,
      finalizedAt: row.finalized_at,
      reason: 'reservation_rolled_back',
      status: 'rolled_back',
    });
  }
  return usageReservationResponseSchema.parse({
    allowed: false,
    appId,
    operation,
    reason: row.denial_reason,
    remainingUnits: row.remaining_units,
    resetsAt: row.resets_at,
    schemaVersion: 2,
    status: 'denied',
  });
}

function mapUsageTransition(
  row: z.infer<typeof usageTransitionRowSchema>,
): UsageReservationTransition {
  return {
    acceptanceId: row.acceptance_id,
    appId: row.app_id,
    authorizationId: row.authorization_id,
    finalizedAt: optionalDate(row.finalized_at),
    finalizeBy: optionalDate(row.acceptance_expires_at),
    operation: row.operation,
    status: row.lifecycle_status,
  };
}

export function createNeonDatabase(
  environment: NodeJS.ProcessEnv,
): DatabasePort {
  const { databaseUrl } = parseDatabaseConfig(environment);
  const sql = neon(databaseUrl);

  return {
    async ping() {
      await sql.query('SELECT 1 AS ok', []);
    },

    async getCurrentMigrationVersion() {
      const rows = await sql.query(
        `SELECT version
           FROM schema_migrations
          ORDER BY version DESC
          LIMIT 1`,
        [],
      );
      const row = migrationVersionRowSchema.array().parse(rows)[0];
      return row?.version ?? null;
    },

    async consumeRateLimits(buckets) {
      const statements = buildConsumeRateLimitsTransaction(buckets);
      if (statements.length === 0) return false;
      const results = await sql.transaction(
        (transaction) =>
          statements.map(({ parameters, text }) =>
            transaction.query(text, [...parameters]),
          ),
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      return rateLimitResultSchema.parse(rows[0]).allowed;
    },

    async createGoogleOauthFlow(flow, maximumConcurrentFlows) {
      const statements = buildCreateGoogleOauthFlowTransaction(
        flow,
        maximumConcurrentFlows,
      );
      const results = await sql.transaction(
        (transaction) =>
          statements.map(({ parameters, text }) =>
            transaction.query(text, [...parameters]),
          ),
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      return flowCreatedRowSchema.parse(rows[0]).created;
    },

    async takeGoogleOauthFlow(stateHash, now) {
      const rows = await sql.query(
        `UPDATE google_oauth_flows
            SET consumed_at = $2
          WHERE state_hash = $1
            AND consumed_at IS NULL
            AND expires_at > $2
        RETURNING state_hash, nonce_hash, encrypted_code_verifier, expires_at,
                  client, extension_flow_id, allocation_key`,
        [stateHash, now],
      );
      const row = oauthFlowRowSchema.array().parse(rows)[0];
      if (row === undefined) return null;
      return {
        allocationKey: row.allocation_key,
        client: row.client,
        encryptedCodeVerifier: row.encrypted_code_verifier,
        expiresAt: row.expires_at,
        extensionFlowId: row.extension_flow_id,
        nonceHash: row.nonce_hash,
        stateHash: row.state_hash,
      } satisfies GoogleOauthFlow;
    },

    async createGoogleSession(input) {
      const statements = buildCreateGoogleSessionTransaction(input);
      const results = await sql.transaction(
        (transaction) =>
          statements.map(({ parameters, text }) =>
            transaction.query(text, [...parameters]),
          ),
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      return mapSession(sessionRowSchema.parse(rows[0]));
    },

    async getSessionByTokenHash(tokenHash, now) {
      const rows = await sql.query(
        `SELECT s.id AS session_id, s.user_id, s.expires_at,
                u.email, u.display_name, u.status,
                gi.subject AS google_subject
           FROM web_sessions s
           JOIN users u ON u.id = s.user_id
           JOIN google_identities gi ON gi.user_id = u.id
          WHERE s.token_hash = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > $2
          ORDER BY gi.last_login_at DESC
          LIMIT 1`,
        [tokenHash, now],
      );
      const row = sessionRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapSession(row);
    },

    async revokeSession(sessionId, now) {
      await sql.query(
        'UPDATE web_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL',
        [sessionId, now],
      );
    },

    async claimAdminIdentity(input) {
      const statements = buildClaimAdminIdentityTransaction(input);
      const results = await sql.transaction(
        (transaction) =>
          statements.map(({ parameters, text }) =>
            transaction.query(text, [...parameters]),
          ),
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      return adminIdentityResultSchema.parse(rows[0]).authorized;
    },

    async isAdminIdentity(input) {
      const rows = await sql.query(
        `SELECT EXISTS (
           SELECT 1
             FROM admin_identities ai
             JOIN google_identities gi
               ON gi.issuer = ai.issuer AND gi.subject = ai.subject
             JOIN users u ON u.id = ai.user_id
            WHERE ai.subject = $1
              AND ai.user_id = $2
              AND gi.user_id = ai.user_id
              AND u.status = 'active'
         ) AS authorized`,
        [input.subject, input.userId],
      );
      return adminIdentityResultSchema.parse(rows[0]).authorized;
    },

    async createExtensionAuthFlow(flow, maximumConcurrentFlows) {
      const statements = buildCreateExtensionFlowTransaction(
        flow,
        maximumConcurrentFlows,
      );
      const results = await sql.transaction(
        (transaction) =>
          statements.map(({ parameters, text }) =>
            transaction.query(text, [...parameters]),
          ),
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      return flowCreatedRowSchema.parse(rows[0]).created;
    },

    async getExtensionAuthFlow(flowId) {
      const rows = await sql.query(
        `SELECT id AS flow_id, app_id, extension_origin, code_challenge,
                status, expires_at, allocation_key, user_code_hash,
                verification_attempts, initiator_verified_at, protocol_version,
                user_id
           FROM extension_auth_flows WHERE id = $1 LIMIT 1`,
        [flowId],
      );
      const row = extensionFlowRowSchema.array().parse(rows)[0];
      if (row === undefined) return null;
      return {
        allocationKey: row.allocation_key,
        appId: row.app_id,
        codeChallenge: row.code_challenge,
        expiresAt: row.expires_at,
        extensionOrigin: row.extension_origin,
        flowId: row.flow_id,
        initiatorVerifiedAt: optionalDate(row.initiator_verified_at),
        protocolVersion: row.protocol_version,
        status: row.status,
        userId: row.user_id,
        userCodeHash: row.user_code_hash,
        verificationAttempts: row.verification_attempts,
      };
    },

    async verifyExtensionAuthFlow(input) {
      const rows = await sql.query(
        `WITH updated AS (
           UPDATE extension_auth_flows
              SET verification_attempts = verification_attempts + 1,
                  initiator_verified_at = CASE
                    WHEN user_code_hash = $2 THEN $4
                    ELSE initiator_verified_at
                  END,
                  status = CASE
                    WHEN user_code_hash = $2 THEN 'authorized'
                    WHEN user_code_hash <> $2
                     AND verification_attempts + 1 >= $3
                      THEN 'denied'
                    ELSE status
                  END,
                  authorized_at = CASE
                    WHEN user_code_hash = $2 THEN $4
                    ELSE authorized_at
                  END,
                  denied_at = CASE
                    WHEN user_code_hash <> $2
                     AND verification_attempts + 1 >= $3
                      THEN $4
                    ELSE denied_at
                  END
            WHERE id = $1
              AND status = 'pending'
              AND expires_at > $4
              AND initiator_verified_at IS NULL
              AND protocol_version = 2
              AND user_id = $5
              AND verification_attempts < $3
           RETURNING verification_attempts AS attempts,
                     initiator_verified_at IS NOT NULL AS verified
         ), selected AS (
           SELECT * FROM updated
           UNION ALL
           SELECT verification_attempts AS attempts, TRUE AS verified
             FROM extension_auth_flows
            WHERE id = $1
              AND initiator_verified_at IS NOT NULL
              AND protocol_version = 2
              AND user_id = $5
              AND expires_at > $4
           LIMIT 1
         )
         SELECT * FROM selected`,
        [
          input.flowId,
          input.userCodeHash,
          input.maximumAttempts,
          input.now,
          input.userId,
        ],
      );
      const row = verificationResultRowSchema.array().parse(rows)[0];
      if (row === undefined)
        return { attempts: input.maximumAttempts, status: 'unavailable' };
      return {
        attempts: row.attempts,
        status: row.verified ? 'verified' : 'invalid',
      };
    },

    async completeExtensionGoogleCallback(input) {
      const rows = await sql.query(
        `WITH changed AS (
           UPDATE extension_auth_flows f
              SET status = CASE
                    WHEN f.protocol_version = 1 THEN 'authorized'
                    ELSE 'pending'
                  END,
                  user_id = $2,
                  authorized_at = CASE
                    WHEN f.protocol_version = 1 THEN $3
                    ELSE NULL
                  END
            FROM users u
           WHERE f.id = $1
             AND f.user_id IS NULL
             AND f.status = 'pending'
             AND f.expires_at > $3
             AND u.id = $2
             AND u.status = 'active'
        RETURNING 'bound'::text AS callback_status, f.protocol_version
         ), existing AS (
           SELECT 'already_bound'::text AS callback_status,
                  f.protocol_version
             FROM extension_auth_flows f
            WHERE f.id = $1
              AND f.user_id IS NOT NULL
         )
         SELECT callback_status, protocol_version FROM changed
         UNION ALL
         SELECT callback_status, protocol_version FROM existing
         LIMIT 1`,
        [input.flowId, input.userId, input.now],
      );
      const row = extensionGoogleCallbackOutcomeRowSchema
        .array()
        .parse(rows)[0];
      if (row === undefined) return { status: 'unavailable' };
      return {
        protocolVersion: row.protocol_version,
        status: row.callback_status,
      };
    },

    async denyExtensionAuthFlow(flowId, now) {
      const statement = buildDenyExtensionAuthFlowStatement(flowId, now);
      await sql.query(statement.text, [...statement.parameters]);
    },

    async consumeExtensionAuthFlow(input) {
      const rows = await sql.query(
        `WITH consumed AS (
           UPDATE extension_auth_flows f
              SET status = 'consumed', consumed_at = $1
             FROM users u
            WHERE f.id = $2
              AND f.user_id = u.id
              AND f.status = 'authorized'
              AND f.consumed_at IS NULL
              AND f.expires_at > $1
              AND f.extension_origin = $3
              AND f.code_challenge = $4
              AND u.status = 'active'
           RETURNING f.user_id, f.app_id, u.email, u.display_name
         ), access AS (
           SELECT consumed.*,
                  CASE
                    WHEN EXISTS (
                      SELECT 1 FROM entitlements e
                       WHERE e.user_id = consumed.user_id
                         AND e.code = 'bundle:all-extensions'
                         AND e.status = 'active'
                         AND (e.expires_at IS NULL OR e.expires_at > $1)
                    ) THEN 'all-apps'
                    WHEN EXISTS (
                      SELECT 1 FROM entitlements e
                       WHERE e.user_id = consumed.user_id
                         AND e.code = 'extension:' || consumed.app_id
                         AND e.status = 'active'
                         AND (e.expires_at IS NULL OR e.expires_at > $1)
                    ) THEN 'single-license'
                    ELSE 'free-plan'
                  END AS plan_code
             FROM consumed
         ), session_write AS (
           INSERT INTO app_sessions
             (id, user_id, app_id, extension_origin, token_hash, expires_at)
           SELECT $5, user_id, app_id, $3, $6, $7 FROM access
           RETURNING user_id
         )
         SELECT access.user_id, access.email, access.display_name,
                access.plan_code
           FROM access JOIN session_write USING (user_id)`,
        [
          input.now,
          input.flowId,
          input.extensionOrigin,
          input.codeChallenge,
          input.appSessionId,
          input.appTokenHash,
          input.expiresAt,
        ],
      );
      const row = extensionSessionGrantRowSchema.array().parse(rows)[0];
      if (row === undefined) return null;
      return {
        displayName: row.display_name,
        email: row.email,
        planCode: row.plan_code,
        userId: row.user_id,
      };
    },

    async getAppSessionByTokenHash(tokenHash, now) {
      const rows = await sql.query(
        `SELECT s.id AS session_id, s.user_id, s.app_id, s.extension_origin,
                s.expires_at, u.status
           FROM app_sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > $2
          LIMIT 1`,
        [tokenHash, now],
      );
      const row = appSessionRowSchema.array().parse(rows)[0];
      if (row === undefined) return null;
      return {
        appId: row.app_id,
        expiresAt: row.expires_at,
        extensionOrigin: row.extension_origin,
        sessionId: row.session_id,
        status: row.status,
        userId: row.user_id,
      };
    },

    async authorizeUsage(input) {
      const statements = buildAuthorizeUsageTransaction(input);
      const results = await sql.transaction(
        (transaction) =>
          statements.map(({ parameters, text }) =>
            transaction.query(text, [...parameters]),
          ),
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      const row = usageDecisionRowSchema.array().parse(rows)[0];
      if (row === undefined) return null;
      if (!row.idempotency_matches) return { kind: 'idempotency_conflict' };
      return {
        kind: 'decision',
        reservation: mapUsageReservation(row, input.appId, input.operation),
      };
    },

    async acceptUsageReservation(input) {
      const lockKeys = [
        `usage-acceptance:${input.acceptanceId}`,
        `usage-authorization:${input.authorizationId}`,
      ].sort();
      const results = await sql.transaction(
        (transaction) => [
          transaction.query(
            `SELECT pg_advisory_xact_lock(hashtext($1)),
                    pg_advisory_xact_lock(hashtext($2))`,
            lockKeys,
          ),
          transaction.query(
            `WITH session_scope AS (
           SELECT s.id
             FROM app_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.id = $5
              AND s.user_id = $1
              AND s.app_id = $2
              AND s.revoked_at IS NULL
              AND s.expires_at > $4
              AND u.status = 'active'
              AND EXISTS (
                SELECT 1 FROM entitlements e
                 WHERE e.user_id = $1
                   AND e.status = 'active'
                   AND (e.expires_at IS NULL OR e.expires_at > $4)
                   AND e.code IN (
                     'extension:' || $2,
                     'bundle:all-extensions'
                   )
              )
         ), changed AS (
           UPDATE usage_authorizations ua
              SET lifecycle_status = CASE
                     WHEN ua.expires_at <= $4 THEN 'expired'
                     ELSE 'accepted'
                   END,
                   accepted_at = CASE
                     WHEN ua.expires_at > $4 THEN $4
                     ELSE accepted_at
                   END,
                   acceptance_expires_at = CASE
                     WHEN ua.expires_at > $4 THEN $7
                     ELSE acceptance_expires_at
                   END,
                  expired_at = CASE
                    WHEN ua.expires_at <= $4 THEN $4
                    ELSE expired_at
                  END,
                   acceptance_id = CASE
                    WHEN ua.expires_at > $4 THEN $6
                    ELSE acceptance_id
                  END
             FROM session_scope
            WHERE ua.id = $3
              AND ua.user_id = $1
              AND ua.app_id = $2
              AND ua.lifecycle_status = 'reserved'
              AND ua.protocol_version = 2
              AND NOT EXISTS (
                SELECT 1 FROM usage_authorizations other
                 WHERE other.user_id = $1
                   AND other.app_id = $2
                   AND other.acceptance_id = $6
                   AND other.id <> ua.id
              )
           RETURNING ua.id AS authorization_id, ua.app_id, ua.operation,
                      ua.lifecycle_status, ua.acceptance_id,
                      ua.acceptance_expires_at,
                      ua.expired_at AS finalized_at,
                      ua.user_id, ua.app_session_id
          ), audit_write AS (
            INSERT INTO usage_authorization_events
              (id, authorization_id, user_id, app_id, app_session_id,
               event_type, acceptance_id, created_at)
            SELECT $8, authorization_id, user_id, app_id, app_session_id,
                   CASE WHEN lifecycle_status = 'accepted'
                     THEN 'accepted' ELSE 'expired' END,
                   acceptance_id, $4
              FROM changed
            ON CONFLICT (id) DO NOTHING
          ), existing AS (
            SELECT ua.id AS authorization_id, ua.app_id, ua.operation,
                   ua.lifecycle_status, ua.acceptance_id,
                   ua.acceptance_expires_at,
                   COALESCE(
                     ua.consumed_at, ua.cancelled_at, ua.rolled_back_at,
                     ua.expired_at
                   ) AS finalized_at
              FROM usage_authorizations ua, session_scope
            WHERE ua.id = $3
              AND ua.user_id = $1
              AND ua.app_id = $2
              AND ua.lifecycle_status IN (
                'accepted', 'consumed', 'cancelled', 'rolled_back', 'expired'
              )
         )
         SELECT authorization_id, app_id, operation, lifecycle_status,
                acceptance_id, acceptance_expires_at, finalized_at
           FROM changed
         UNION ALL
         SELECT * FROM existing
             LIMIT 1`,
            [
              input.userId,
              input.appId,
              input.authorizationId,
              input.now,
              input.sessionId,
              input.acceptanceId,
              input.acceptanceExpiresAt,
              input.eventId,
            ],
          ),
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      const row = usageTransitionRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapUsageTransition(row);
    },

    async finalizeUsageReservation(input) {
      const lockKeys = [
        `usage-acceptance:${input.acceptanceId}`,
        `usage-authorization:${input.authorizationId}`,
      ].sort();
      const results = await sql.transaction(
        (transaction) => [
          transaction.query(
            `SELECT pg_advisory_xact_lock(hashtext($1)),
                    pg_advisory_xact_lock(hashtext($2))`,
            lockKeys,
          ),
          transaction.query(
            `WITH session_scope AS (
               SELECT s.id
                 FROM app_sessions s
                 JOIN users u ON u.id = s.user_id
                WHERE s.id = $5
                  AND s.user_id = $1
                  AND s.app_id = $2
                  AND s.revoked_at IS NULL
                  AND s.expires_at > $4
                  AND u.status = 'active'
             ), changed AS (
               UPDATE usage_authorizations ua
                  SET lifecycle_status = CASE
                        WHEN ua.acceptance_expires_at <= $4
                          THEN 'rolled_back'
                        ELSE 'consumed'
                      END,
                      consumed_at = CASE
                        WHEN ua.acceptance_expires_at > $4 THEN $4
                        ELSE consumed_at
                      END,
                      rolled_back_at = CASE
                        WHEN ua.acceptance_expires_at <= $4 THEN $4
                        ELSE rolled_back_at
                      END
                 FROM session_scope
                WHERE ua.id = $3
                  AND ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.protocol_version = 2
                  AND ua.lifecycle_status = 'accepted'
                  AND ua.acceptance_id = $6
               RETURNING ua.id AS authorization_id, ua.app_id, ua.operation,
                         ua.lifecycle_status, ua.acceptance_id,
                         ua.acceptance_expires_at,
                         COALESCE(ua.consumed_at, ua.rolled_back_at) AS finalized_at,
                         ua.user_id, ua.app_session_id
             ), audit_write AS (
               INSERT INTO usage_authorization_events
                 (id, authorization_id, user_id, app_id, app_session_id,
                  event_type, acceptance_id, created_at)
               SELECT $7, authorization_id, user_id, app_id, app_session_id,
                      CASE WHEN lifecycle_status = 'consumed'
                        THEN 'finalized' ELSE 'auto_rolled_back' END,
                      acceptance_id, $4
                 FROM changed
               ON CONFLICT (id) DO NOTHING
             ), existing AS (
               SELECT ua.id AS authorization_id, ua.app_id, ua.operation,
                      ua.lifecycle_status, ua.acceptance_id,
                      ua.acceptance_expires_at,
                      COALESCE(
                        ua.consumed_at, ua.cancelled_at, ua.rolled_back_at,
                        ua.expired_at
                      ) AS finalized_at
                 FROM usage_authorizations ua, session_scope
                WHERE ua.id = $3
                  AND ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.lifecycle_status IN (
                    'consumed', 'cancelled', 'rolled_back', 'expired'
                  )
             )
             SELECT authorization_id, app_id, operation, lifecycle_status,
                    acceptance_id, acceptance_expires_at, finalized_at
               FROM changed
             UNION ALL
             SELECT * FROM existing
             LIMIT 1`,
            [
              input.userId,
              input.appId,
              input.authorizationId,
              input.now,
              input.sessionId,
              input.acceptanceId,
              input.eventId,
            ],
          ),
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      const row = usageTransitionRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapUsageTransition(row);
    },

    async rollbackUsageReservation(input) {
      const lockKeys = [
        `usage-acceptance:${input.acceptanceId}`,
        `usage-authorization:${input.authorizationId}`,
      ].sort();
      const results = await sql.transaction(
        (transaction) => [
          transaction.query(
            `SELECT pg_advisory_xact_lock(hashtext($1)),
                    pg_advisory_xact_lock(hashtext($2))`,
            lockKeys,
          ),
          transaction.query(
            `WITH session_scope AS (
               SELECT s.id
                 FROM app_sessions s
                 JOIN users u ON u.id = s.user_id
                WHERE s.id = $5
                  AND s.user_id = $1
                  AND s.app_id = $2
                  AND s.revoked_at IS NULL
                  AND s.expires_at > $4
                  AND u.status = 'active'
             ), changed AS (
               UPDATE usage_authorizations ua
                  SET lifecycle_status = 'rolled_back',
                      acceptance_id = COALESCE(ua.acceptance_id, $6),
                      rolled_back_at = $4
                 FROM session_scope
                WHERE ua.id = $3
                  AND ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.protocol_version = 2
                  AND (
                    ua.lifecycle_status = 'reserved'
                    OR (
                      ua.lifecycle_status = 'accepted'
                      AND ua.acceptance_id = $6
                    )
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM usage_authorizations other
                     WHERE other.user_id = $1
                       AND other.app_id = $2
                       AND other.acceptance_id = $6
                       AND other.id <> ua.id
                  )
               RETURNING ua.id AS authorization_id, ua.app_id, ua.operation,
                         ua.lifecycle_status, ua.acceptance_id,
                         ua.acceptance_expires_at,
                         ua.rolled_back_at AS finalized_at,
                         ua.user_id, ua.app_session_id
             ), audit_write AS (
               INSERT INTO usage_authorization_events
                 (id, authorization_id, user_id, app_id, app_session_id,
                  event_type, acceptance_id, created_at)
               SELECT $7, authorization_id, user_id, app_id, app_session_id,
                      'rolled_back', acceptance_id, $4
                 FROM changed
               ON CONFLICT (id) DO NOTHING
             ), existing AS (
               SELECT ua.id AS authorization_id, ua.app_id, ua.operation,
                      ua.lifecycle_status, ua.acceptance_id,
                      ua.acceptance_expires_at,
                      COALESCE(
                        ua.consumed_at, ua.cancelled_at, ua.rolled_back_at,
                        ua.expired_at
                      ) AS finalized_at
                 FROM usage_authorizations ua, session_scope
                WHERE ua.id = $3
                  AND ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.lifecycle_status IN (
                    'consumed', 'cancelled', 'rolled_back', 'expired'
                  )
             )
             SELECT authorization_id, app_id, operation, lifecycle_status,
                    acceptance_id, acceptance_expires_at, finalized_at
               FROM changed
             UNION ALL
             SELECT * FROM existing
             LIMIT 1`,
            [
              input.userId,
              input.appId,
              input.authorizationId,
              input.now,
              input.sessionId,
              input.acceptanceId,
              input.eventId,
            ],
          ),
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      const row = usageTransitionRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapUsageTransition(row);
    },

    async consumeLegacyUsageReservation(input) {
      const lockKeys = [
        `usage-acceptance:${input.acceptanceId}`,
        `usage-authorization:${input.authorizationId}`,
      ].sort();
      const results = await sql.transaction(
        (transaction) => [
          transaction.query(
            `SELECT pg_advisory_xact_lock(hashtext($1)),
                    pg_advisory_xact_lock(hashtext($2))`,
            lockKeys,
          ),
          transaction.query(
            `WITH session_scope AS (
               SELECT s.id
                 FROM app_sessions s
                 JOIN users u ON u.id = s.user_id
                WHERE s.id = $5
                  AND s.user_id = $1
                  AND s.app_id = $2
                  AND s.revoked_at IS NULL
                  AND s.expires_at > $4
                  AND u.status = 'active'
                  AND EXISTS (
                    SELECT 1 FROM entitlements e
                     WHERE e.user_id = $1
                       AND e.status = 'active'
                       AND (e.expires_at IS NULL OR e.expires_at > $4)
                       AND e.code IN (
                         'extension:' || $2, 'bundle:all-extensions'
                       )
                  )
             ), changed AS (
               UPDATE usage_authorizations ua
                  SET lifecycle_status = CASE
                        WHEN ua.expires_at <= $4 THEN 'expired'
                        ELSE 'consumed'
                      END,
                      consumed_at = CASE
                        WHEN ua.expires_at > $4 THEN $4 ELSE consumed_at
                      END,
                      expired_at = CASE
                        WHEN ua.expires_at <= $4 THEN $4 ELSE expired_at
                      END,
                      acceptance_id = CASE
                        WHEN ua.expires_at > $4 THEN $6 ELSE acceptance_id
                      END
                 FROM session_scope
                WHERE ua.id = $3
                  AND ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.protocol_version = 1
                  AND ua.lifecycle_status = 'reserved'
                  AND NOT EXISTS (
                    SELECT 1 FROM usage_authorizations other
                     WHERE other.user_id = $1
                       AND other.app_id = $2
                       AND other.acceptance_id = $6
                       AND other.id <> ua.id
                  )
               RETURNING ua.id AS authorization_id, ua.app_id, ua.operation,
                         ua.lifecycle_status, ua.acceptance_id,
                         NULL::timestamptz AS acceptance_expires_at,
                         COALESCE(ua.consumed_at, ua.expired_at) AS finalized_at,
                         ua.user_id, ua.app_session_id
             ), audit_write AS (
               INSERT INTO usage_authorization_events
                 (id, authorization_id, user_id, app_id, app_session_id,
                  event_type, acceptance_id, created_at)
               SELECT $7, authorization_id, user_id, app_id, app_session_id,
                      CASE WHEN lifecycle_status = 'consumed'
                        THEN 'legacy_consumed' ELSE 'expired' END,
                      acceptance_id, $4
                 FROM changed
               ON CONFLICT (id) DO NOTHING
             ), existing AS (
               SELECT ua.id AS authorization_id, ua.app_id, ua.operation,
                      ua.lifecycle_status, ua.acceptance_id,
                      NULL::timestamptz AS acceptance_expires_at,
                      COALESCE(
                        ua.consumed_at, ua.cancelled_at, ua.rolled_back_at,
                        ua.expired_at
                      ) AS finalized_at
                 FROM usage_authorizations ua, session_scope
                WHERE ua.id = $3
                  AND ua.user_id = $1
                  AND ua.app_id = $2
                  AND ua.protocol_version = 1
                  AND ua.lifecycle_status IN (
                    'consumed', 'cancelled', 'rolled_back', 'expired'
                  )
             )
             SELECT authorization_id, app_id, operation, lifecycle_status,
                    acceptance_id, acceptance_expires_at, finalized_at
               FROM changed
             UNION ALL
             SELECT * FROM existing
             LIMIT 1`,
            [
              input.userId,
              input.appId,
              input.authorizationId,
              input.now,
              input.sessionId,
              input.acceptanceId,
              input.eventId,
            ],
          ),
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      const row = usageTransitionRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapUsageTransition(row);
    },

    async cancelUsageReservation(input) {
      const results = await sql.transaction(
        (transaction) => [
          transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `usage-authorization:${input.authorizationId}`,
          ]),
          transaction.query(
            `WITH session_scope AS (
           SELECT s.id
             FROM app_sessions s
             JOIN users u ON u.id = s.user_id
            WHERE s.id = $5
              AND s.user_id = $1
              AND s.app_id = $2
              AND s.revoked_at IS NULL
              AND s.expires_at > $4
              AND u.status = 'active'
          ), changed AS (
           UPDATE usage_authorizations ua
              SET lifecycle_status = CASE
                    WHEN ua.expires_at <= $4 THEN 'expired'
                    ELSE 'cancelled'
                  END,
                  cancelled_at = CASE
                    WHEN ua.expires_at > $4 THEN $4
                    ELSE cancelled_at
                  END,
                  expired_at = CASE
                    WHEN ua.expires_at <= $4 THEN $4
                    ELSE expired_at
                  END
             FROM session_scope
            WHERE ua.id = $3
              AND ua.user_id = $1
              AND ua.app_id = $2
              AND ua.lifecycle_status = 'reserved'
              AND ua.protocol_version = 2
           RETURNING ua.id AS authorization_id, ua.app_id, ua.operation,
                      ua.lifecycle_status, ua.acceptance_id,
                      ua.acceptance_expires_at,
                      COALESCE(ua.cancelled_at, ua.expired_at) AS finalized_at,
                      ua.user_id, ua.app_session_id
          ), audit_write AS (
            INSERT INTO usage_authorization_events
              (id, authorization_id, user_id, app_id, app_session_id,
               event_type, acceptance_id, created_at)
            SELECT $6, authorization_id, user_id, app_id, app_session_id,
                   CASE WHEN lifecycle_status = 'cancelled'
                     THEN 'cancelled' ELSE 'expired' END,
                   acceptance_id, $4
              FROM changed
            ON CONFLICT (id) DO NOTHING
          ), existing AS (
            SELECT ua.id AS authorization_id, ua.app_id, ua.operation,
                   ua.lifecycle_status, ua.acceptance_id,
                   ua.acceptance_expires_at,
                   COALESCE(
                     ua.consumed_at, ua.cancelled_at, ua.rolled_back_at,
                     ua.expired_at
                   ) AS finalized_at
             FROM usage_authorizations ua, session_scope
            WHERE ua.id = $3
              AND ua.user_id = $1
              AND ua.app_id = $2
              AND ua.lifecycle_status IN (
                'accepted', 'consumed', 'cancelled', 'rolled_back', 'expired'
              )
          )
          SELECT authorization_id, app_id, operation, lifecycle_status,
                 acceptance_id, acceptance_expires_at, finalized_at
            FROM changed
          UNION ALL
          SELECT * FROM existing
             LIMIT 1`,
            [
              input.userId,
              input.appId,
              input.authorizationId,
              input.now,
              input.sessionId,
              input.eventId,
            ],
          ),
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      const rows = results[results.length - 1] ?? [];
      const row = usageTransitionRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapUsageTransition(row);
    },

    async getPlatformSettings() {
      const rows = await sql.query(
        'SELECT revision, settings, updated_at FROM platform_settings WHERE singleton = TRUE',
        [],
      );
      return mapSettings(platformSettingsRowSchema.parse(rows[0]));
    },

    async getPublishedGuide(slug) {
      const rows = await sql.query(
        `${guideSelection}
          WHERE g.slug = $1 AND g.status = 'published'
          LIMIT 1`,
        [slug],
      );
      const row = guideRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapPublishedGuide(row);
    },

    async listGuides() {
      const rows = await sql.query(
        `SELECT slug, app_id, title, summary, status, revision,
                updated_at, published_at
           FROM tool_guides
          ORDER BY updated_at DESC, slug ASC
          LIMIT 250`,
        [],
      );
      return guideSummaryRowSchema
        .array()
        .parse(rows)
        .map((row) => {
          return guideAdminSummarySchema.parse({
            appId: row.app_id,
            publishedAt: optionalDate(row.published_at),
            revision: String(row.revision),
            schemaVersion: 1,
            slug: row.slug,
            status: row.status,
            summary: row.summary,
            title: row.title,
            updatedAt: row.updated_at,
          }) satisfies GuideAdminSummary;
        });
    },

    async getGuide(slug) {
      const rows = await sql.query(
        `${guideSelection} WHERE g.slug = $1 LIMIT 1`,
        [slug],
      );
      const row = guideRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapAdminGuide(row);
    },

    async createGuide(input) {
      const rows = await sql.query(
        `WITH inserted AS (
           INSERT INTO tool_guides
             (slug, app_id, title, summary, status, content, revision,
              created_at, updated_at, published_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, $7, $7,
                   CASE WHEN $5 = 'published' THEN $7 ELSE NULL END, $8)
           ON CONFLICT (slug) DO NOTHING
           RETURNING *
         ), snapshot AS (
           INSERT INTO tool_guide_revisions
             (guide_slug, revision, app_id, title, summary, status, content,
              created_at, published_at, updated_by)
           SELECT slug, revision, app_id, title, summary, status, content,
                  updated_at, published_at, updated_by
             FROM inserted
           RETURNING guide_slug
         ), audit AS (
           INSERT INTO admin_audit_log
             (id, actor_user_id, action, target_type, target_id, created_at)
           SELECT $9, $8, 'tool_guide.create', 'tool_guide', slug, $7
             FROM inserted
           RETURNING target_id
         )
         SELECT inserted.slug, inserted.app_id, inserted.title,
                inserted.summary, inserted.status, inserted.content,
                inserted.revision, inserted.created_at, inserted.updated_at,
                inserted.published_at,
                inserted.updated_by AS updated_by_user_id,
                users.display_name AS updated_by_display_name
           FROM inserted
           JOIN snapshot ON snapshot.guide_slug = inserted.slug
           JOIN audit ON audit.target_id = inserted.slug
           LEFT JOIN users ON users.id = inserted.updated_by`,
        [
          input.slug,
          input.appId,
          input.title,
          input.summary,
          input.status,
          JSON.stringify(input.content),
          input.now,
          input.actorUserId,
          input.auditId,
        ],
      );
      const row = guideRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapAdminGuide(row);
    },

    async updateGuide(input) {
      const rows = await sql.query(
        `WITH changed AS (
           UPDATE tool_guides
              SET app_id = $1,
                  title = $2,
                  summary = $3,
                  status = $4,
                  content = $5::jsonb,
                  revision = revision + 1,
                  updated_at = $6,
                  published_at = CASE
                    WHEN $4 = 'published' THEN COALESCE(published_at, $6)
                    ELSE NULL
                  END,
                  updated_by = $7
            WHERE slug = $8
              AND revision = $9::integer
              AND revision < 2147483647
           RETURNING *
         ), snapshot AS (
           INSERT INTO tool_guide_revisions
             (guide_slug, revision, app_id, title, summary, status, content,
              created_at, published_at, updated_by)
           SELECT slug, revision, app_id, title, summary, status, content,
                  updated_at, published_at, updated_by
             FROM changed
           RETURNING guide_slug
         ), audit AS (
           INSERT INTO admin_audit_log
             (id, actor_user_id, action, target_type, target_id, created_at)
           SELECT $10, $7, 'tool_guide.update', 'tool_guide', slug, $6
             FROM changed
           RETURNING target_id
         )
         SELECT changed.slug, changed.app_id, changed.title, changed.summary,
                changed.status, changed.content, changed.revision,
                changed.created_at, changed.updated_at, changed.published_at,
                changed.updated_by AS updated_by_user_id,
                users.display_name AS updated_by_display_name
           FROM changed
           JOIN snapshot ON snapshot.guide_slug = changed.slug
           JOIN audit ON audit.target_id = changed.slug
           LEFT JOIN users ON users.id = changed.updated_by`,
        [
          input.appId,
          input.title,
          input.summary,
          input.status,
          JSON.stringify(input.content),
          input.now,
          input.actorUserId,
          input.slug,
          input.expectedRevision,
          input.auditId,
        ],
      );
      const row = guideRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapAdminGuide(row);
    },

    async updatePlatformSettings(input) {
      const rows = await sql.query(
        `WITH changed AS (
           UPDATE platform_settings
              SET settings = $1::jsonb,
                  revision = revision + 1,
                  updated_at = $2,
                  updated_by = $3
            WHERE singleton = TRUE AND revision = $4::integer
           RETURNING revision, settings, updated_at
         ), audit AS (
           INSERT INTO admin_audit_log
             (id, actor_user_id, action, target_type, target_id, created_at)
           SELECT $5, $3, 'platform.settings.update', 'platform_settings', 'singleton', $2
             FROM changed
         )
         SELECT revision, settings, updated_at FROM changed`,
        [
          JSON.stringify(input.value),
          input.now,
          input.actorUserId,
          input.expectedRevision,
          input.auditId,
        ],
      );
      const row = platformSettingsRowSchema.array().parse(rows)[0];
      return row === undefined ? null : mapSettings(row);
    },

    async getAdminOverview() {
      const rows = await sql.query(
        `SELECT
          (SELECT COUNT(*) FROM users)::int AS total_users,
          (SELECT COUNT(*) FROM users WHERE status = 'active')::int AS active_users,
          (SELECT COUNT(*) FROM users WHERE status = 'banned')::int AS banned_users,
          (SELECT COUNT(*) FROM entitlements WHERE status = 'active')::int AS active_entitlements,
          (SELECT COUNT(*) FROM entitlements WHERE status = 'revoked')::int AS revoked_entitlements,
          (SELECT COUNT(*) FROM stripe_webhook_events WHERE status = 'pending')::int AS pending_stripe_events`,
        [],
      );
      const row = overviewRowSchema.parse(rows[0]);
      return adminOverviewSchema.parse({
        entitlements: {
          active: row.active_entitlements,
          revoked: row.revoked_entitlements,
        },
        pendingStripeEvents: row.pending_stripe_events,
        users: {
          active: row.active_users,
          banned: row.banned_users,
          total: row.total_users,
        },
      });
    },

    async listUsers(input) {
      const escapedQuery = input.query
        ?.replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      const search = escapedQuery === undefined ? null : `%${escapedQuery}%`;
      const rows = await sql.query(
        `SELECT id, email, display_name, status, created_at, last_login_at, banned_at, ban_reason
           FROM users
          WHERE ($1::text IS NULL OR email ILIKE $1 ESCAPE '\\' OR COALESCE(display_name, '') ILIKE $1 ESCAPE '\\')
            AND ($2::text IS NULL OR id > $2)
          ORDER BY id ASC
          LIMIT $3`,
        [search, input.cursor ?? null, input.limit + 1],
      );
      return page(
        adminUserRowSchema.array().parse(rows).map(mapUser),
        input.limit,
      );
    },

    async setUserBan(input) {
      const rows = await sql.query(
        `WITH changed AS (
           UPDATE users
              SET status = CASE WHEN $1 THEN 'banned' ELSE 'active' END,
                  banned_at = CASE WHEN $1 THEN $2::timestamptz ELSE NULL END,
                  ban_reason = CASE WHEN $1 THEN $3 ELSE NULL END,
                  updated_at = $2
            WHERE id = $4 AND id <> $5
            RETURNING id
         ), revoked_sessions AS (
           UPDATE web_sessions SET revoked_at = $2
            WHERE user_id IN (SELECT id FROM changed)
              AND revoked_at IS NULL
              AND $1
         ), revoked_app_sessions AS (
           UPDATE app_sessions SET revoked_at = $2
            WHERE user_id IN (SELECT id FROM changed)
              AND revoked_at IS NULL
              AND $1
         ), audit AS (
           INSERT INTO admin_audit_log
             (id, actor_user_id, action, target_type, target_id, reason, created_at)
           SELECT $6, $5,
                  CASE WHEN $1 THEN 'user.ban' ELSE 'user.unban' END,
                  'user', id, $3, $2
             FROM changed
         )
         SELECT EXISTS(SELECT 1 FROM changed) AS changed`,
        [
          input.ban,
          input.now,
          input.reason,
          input.userId,
          input.actorUserId,
          input.auditId,
        ],
      );
      return booleanRowSchema.parse(rows[0]).changed;
    },

    async listEntitlements(input) {
      const escapedQuery = input.query
        ?.replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      const search = escapedQuery === undefined ? null : `%${escapedQuery}%`;
      const rows = await sql.query(
        `SELECT e.id, e.user_id, u.email AS user_email, e.code, e.status, e.source,
                e.granted_at, e.expires_at, e.revoked_at, e.revoke_reason
           FROM entitlements e JOIN users u ON u.id = e.user_id
          WHERE ($1::text IS NULL OR u.email ILIKE $1 ESCAPE '\\' OR e.code ILIKE $1 ESCAPE '\\')
            AND ($2::text IS NULL OR e.id > $2)
          ORDER BY e.id ASC
          LIMIT $3`,
        [search, input.cursor ?? null, input.limit + 1],
      );
      return page(
        entitlementRowSchema.array().parse(rows).map(mapEntitlement),
        input.limit,
      );
    },

    async revokeEntitlement(input) {
      const rows = await sql.query(
        `WITH changed AS (
           UPDATE entitlements
              SET status = 'revoked', revoked_at = $1, revoke_reason = $2, updated_at = $1
            WHERE id = $3 AND status = 'active'
           RETURNING id
         ), audit AS (
           INSERT INTO admin_audit_log
             (id, actor_user_id, action, target_type, target_id, reason, created_at)
           SELECT $4, $5, 'entitlement.revoke', 'entitlement', id, $2, $1
             FROM changed
         )
         SELECT EXISTS(SELECT 1 FROM changed) AS changed`,
        [
          input.now,
          input.reason,
          input.entitlementId,
          input.auditId,
          input.actorUserId,
        ],
      );
      return booleanRowSchema.parse(rows[0]).changed;
    },

    async listAuditEvents(input) {
      const statement = buildListAuditEventsStatement(input);
      const rows = await sql.query(statement.text, [...statement.parameters]);
      return auditPage(
        auditEventRowSchema.array().parse(rows).map(mapAuditEvent),
        input.limit,
      );
    },

    async enqueueStripeEvent(input) {
      const rows = await sql.query(
        `INSERT INTO stripe_webhook_events
          (event_id, event_type, livemode, payload, received_at, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, 'pending')
         ON CONFLICT (event_id) DO NOTHING
         RETURNING TRUE AS inserted`,
        [
          input.eventId,
          input.eventType,
          input.livemode,
          input.payload,
          input.receivedAt,
        ],
      );
      if (rows.length === 0) return false;
      return insertedRowSchema.parse(rows[0]).inserted;
    },
  };
}
