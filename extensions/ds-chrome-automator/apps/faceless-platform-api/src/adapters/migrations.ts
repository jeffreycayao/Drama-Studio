import { Pool } from '@neondatabase/serverless';
import { guideContentSchema } from '@faceless-automations/platform-contracts';
import { z } from 'zod';

import { parseDatabaseConfig } from '../config/env.js';

export const PLATFORM_DISPLAY_NAME = 'Paks Tools Faceless automations';
export const CURRENT_MIGRATION_VERSION = '0005_guide_cms';
export const MIGRATION_TRANSACTION_BEGIN =
  'BEGIN ISOLATION LEVEL READ COMMITTED';

const legacyPlatformDisplayName = 'Faceless Automations';
const baseMigrationVersion = '0001_initial';
const extensionMigrationVersion = '0002_extension_platform';
const brandRenameMigrationVersion = '0003_brand_rename';
const securityLifecycleMigrationVersion = '0004_security_lifecycle';
const guideCmsMigrationVersion = '0005_guide_cms';

const statements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT NOW()
   )`,
  `SELECT pg_advisory_xact_lock(704219001)`,
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     email text NOT NULL,
     display_name text,
     status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
     created_at timestamptz NOT NULL DEFAULT NOW(),
     updated_at timestamptz NOT NULL DEFAULT NOW(),
     last_login_at timestamptz,
     banned_at timestamptz,
     ban_reason text
   )`,
  `CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))`,
  `CREATE INDEX IF NOT EXISTS users_status_idx ON users (status)`,
  `CREATE TABLE IF NOT EXISTS google_identities (
     issuer text NOT NULL,
     subject text NOT NULL,
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     email text NOT NULL,
     display_name text,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     last_login_at timestamptz NOT NULL DEFAULT NOW(),
     PRIMARY KEY (issuer, subject)
   )`,
  `CREATE INDEX IF NOT EXISTS google_identities_user_id_idx ON google_identities (user_id)`,
  `CREATE TABLE IF NOT EXISTS web_sessions (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash char(64) NOT NULL UNIQUE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS web_sessions_user_active_idx
     ON web_sessions (user_id, expires_at) WHERE revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS google_oauth_flows (
     state_hash char(64) PRIMARY KEY,
     nonce_hash char(64) NOT NULL,
     encrypted_code_verifier text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     expires_at timestamptz NOT NULL,
     consumed_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS google_oauth_flows_expiry_idx ON google_oauth_flows (expires_at)`,
  `CREATE TABLE IF NOT EXISTS platform_settings (
     singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
     revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
     settings jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT NOW(),
     updated_by text REFERENCES users(id) ON DELETE SET NULL
   )`,
  `INSERT INTO platform_settings (singleton, revision, settings)
   VALUES (TRUE, 0, $1::jsonb)
   ON CONFLICT (singleton) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS entitlements (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     code text NOT NULL,
     status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
     source text NOT NULL CHECK (source IN ('stripe', 'admin', 'migration')),
     source_reference text,
     granted_at timestamptz NOT NULL DEFAULT NOW(),
     expires_at timestamptz,
     revoked_at timestamptz,
     revoke_reason text,
     updated_at timestamptz NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS entitlements_user_status_idx ON entitlements (user_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS entitlements_source_reference_idx
     ON entitlements (source, source_reference) WHERE source_reference IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS admin_audit_log (
     id text PRIMARY KEY,
     actor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
     action text NOT NULL,
     target_type text NOT NULL,
     target_id text NOT NULL,
     reason text,
     created_at timestamptz NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON admin_audit_log (target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
     event_id text PRIMARY KEY,
     event_type text NOT NULL,
     livemode boolean NOT NULL,
     payload jsonb NOT NULL,
     status text NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
     received_at timestamptz NOT NULL,
     processed_at timestamptz,
     failure_code text
   )`,
  `CREATE INDEX IF NOT EXISTS stripe_webhook_events_pending_idx
     ON stripe_webhook_events (received_at) WHERE status = 'pending'`,
] as const;

const extensionStatements = [
  `CREATE TABLE IF NOT EXISTS extension_auth_flows (
     id text PRIMARY KEY,
     app_id text NOT NULL,
     extension_origin text NOT NULL,
     code_challenge char(43) NOT NULL,
     status text NOT NULL CHECK (status IN ('pending', 'authorized', 'denied', 'consumed')),
     user_id text REFERENCES users(id) ON DELETE SET NULL,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     expires_at timestamptz NOT NULL,
     authorized_at timestamptz,
     denied_at timestamptz,
     consumed_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS extension_auth_flows_expiry_idx
     ON extension_auth_flows (expires_at)`,
  `CREATE INDEX IF NOT EXISTS extension_auth_flows_user_idx
     ON extension_auth_flows (user_id) WHERE user_id IS NOT NULL`,
  `ALTER TABLE google_oauth_flows
     ADD COLUMN IF NOT EXISTS client text NOT NULL DEFAULT 'dashboard'`,
  `ALTER TABLE google_oauth_flows
     ADD COLUMN IF NOT EXISTS extension_flow_id text`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'google_oauth_flows_client_check'
          AND conrelid = 'google_oauth_flows'::regclass
     ) THEN
       ALTER TABLE google_oauth_flows
         ADD CONSTRAINT google_oauth_flows_client_check
         CHECK (client IN ('dashboard', 'extension'));
     END IF;
   END
   $$`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'google_oauth_flows_extension_binding_check'
          AND conrelid = 'google_oauth_flows'::regclass
     ) THEN
       ALTER TABLE google_oauth_flows
         ADD CONSTRAINT google_oauth_flows_extension_binding_check
         CHECK (
           (client = 'dashboard' AND extension_flow_id IS NULL) OR
           (client = 'extension' AND extension_flow_id IS NOT NULL)
         );
     END IF;
   END
   $$`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'google_oauth_flows_extension_flow_fk'
          AND conrelid = 'google_oauth_flows'::regclass
     ) THEN
       ALTER TABLE google_oauth_flows
         ADD CONSTRAINT google_oauth_flows_extension_flow_fk
         FOREIGN KEY (extension_flow_id)
         REFERENCES extension_auth_flows(id) ON DELETE CASCADE;
     END IF;
   END
   $$`,
  `CREATE INDEX IF NOT EXISTS google_oauth_flows_extension_flow_idx
     ON google_oauth_flows (extension_flow_id)
     WHERE extension_flow_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS app_sessions (
     id text PRIMARY KEY,
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     app_id text NOT NULL,
     extension_origin text NOT NULL,
     token_hash char(64) NOT NULL UNIQUE,
     created_at timestamptz NOT NULL DEFAULT NOW(),
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS app_sessions_user_active_idx
     ON app_sessions (user_id, app_id, expires_at) WHERE revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS usage_authorizations (
     id text PRIMARY KEY,
     app_session_id text NOT NULL REFERENCES app_sessions(id) ON DELETE CASCADE,
     user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     app_id text NOT NULL,
     operation text NOT NULL,
     units integer NOT NULL CHECK (units BETWEEN 1 AND 1000),
     idempotency_key text NOT NULL,
     allowed boolean NOT NULL,
     denial_reason text CHECK (
       denial_reason IS NULL OR denial_reason IN (
         'entitlement_required', 'quota_exhausted',
         'app_disabled', 'operation_disabled'
       )
     ),
     CONSTRAINT usage_authorizations_decision_check CHECK (
       (allowed AND denial_reason IS NULL) OR
       (NOT allowed AND denial_reason IS NOT NULL)
     ),
     remaining_units integer NOT NULL CHECK (remaining_units >= 0),
     resets_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL,
     expires_at timestamptz NOT NULL,
     consumed_at timestamptz,
     UNIQUE (user_id, app_id, idempotency_key)
   )`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'usage_authorizations_decision_check'
          AND conrelid = 'usage_authorizations'::regclass
     ) THEN
       ALTER TABLE usage_authorizations
         ADD CONSTRAINT usage_authorizations_decision_check
         CHECK (
           (allowed AND denial_reason IS NULL) OR
           (NOT allowed AND denial_reason IS NOT NULL)
         );
     END IF;
   END
   $$`,
  `CREATE INDEX IF NOT EXISTS usage_authorizations_daily_idx
     ON usage_authorizations (user_id, app_id, created_at) WHERE allowed`,
  `CREATE INDEX IF NOT EXISTS usage_authorizations_expiry_idx
     ON usage_authorizations (expires_at)`,
] as const;

const securityLifecycleStatements = [
  `ALTER TABLE extension_auth_flows
     ADD COLUMN IF NOT EXISTS protocol_version smallint NOT NULL DEFAULT 1`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'extension_auth_flows_protocol_version_check'
          AND conrelid = 'extension_auth_flows'::regclass
     ) THEN
       ALTER TABLE extension_auth_flows
         ADD CONSTRAINT extension_auth_flows_protocol_version_check
         CHECK (protocol_version IN (1, 2));
     END IF;
   END
   $$`,
  `ALTER TABLE extension_auth_flows
     ADD COLUMN IF NOT EXISTS allocation_key char(64)`,
  `UPDATE extension_auth_flows
      SET allocation_key = repeat('0', 64)
    WHERE allocation_key IS NULL`,
  `ALTER TABLE extension_auth_flows
     ALTER COLUMN allocation_key SET NOT NULL`,
  `ALTER TABLE extension_auth_flows
     ADD COLUMN IF NOT EXISTS user_code_hash char(64)`,
  `UPDATE extension_auth_flows
      SET user_code_hash = repeat('0', 64)
    WHERE user_code_hash IS NULL`,
  `ALTER TABLE extension_auth_flows
     ALTER COLUMN user_code_hash SET NOT NULL`,
  `ALTER TABLE extension_auth_flows
     ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0`,
  `ALTER TABLE extension_auth_flows
     ADD COLUMN IF NOT EXISTS initiator_verified_at timestamptz`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'extension_auth_flows_verification_attempts_check'
          AND conrelid = 'extension_auth_flows'::regclass
     ) THEN
       ALTER TABLE extension_auth_flows
         ADD CONSTRAINT extension_auth_flows_verification_attempts_check
         CHECK (verification_attempts BETWEEN 0 AND 5);
     END IF;
   END
   $$`,
  `CREATE INDEX IF NOT EXISTS extension_auth_flows_allocation_idx
     ON extension_auth_flows (allocation_key, expires_at)
     WHERE status IN ('pending', 'authorized')`,
  `ALTER TABLE google_oauth_flows
     ADD COLUMN IF NOT EXISTS allocation_key char(64)`,
  `UPDATE google_oauth_flows
      SET allocation_key = repeat('0', 64)
    WHERE allocation_key IS NULL`,
  `ALTER TABLE google_oauth_flows
     ALTER COLUMN allocation_key SET NOT NULL`,
  `CREATE INDEX IF NOT EXISTS google_oauth_flows_allocation_idx
     ON google_oauth_flows (allocation_key, expires_at)
     WHERE consumed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS rate_limit_buckets (
     bucket_key char(64) NOT NULL,
     window_started_at timestamptz NOT NULL,
     request_count integer NOT NULL CHECK (request_count > 0),
     request_limit integer NOT NULL CHECK (request_limit > 0),
     expires_at timestamptz NOT NULL,
     updated_at timestamptz NOT NULL,
     PRIMARY KEY (bucket_key, window_started_at)
   )`,
  `CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx
     ON rate_limit_buckets (expires_at)`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS lifecycle_status text`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS protocol_version smallint NOT NULL DEFAULT 1`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'usage_authorizations_protocol_version_check'
          AND conrelid = 'usage_authorizations'::regclass
     ) THEN
       ALTER TABLE usage_authorizations
         ADD CONSTRAINT usage_authorizations_protocol_version_check
         CHECK (protocol_version IN (1, 2));
     END IF;
   END
   $$`,
  `UPDATE usage_authorizations
      SET lifecycle_status = CASE WHEN allowed THEN 'consumed' ELSE 'denied' END
    WHERE lifecycle_status IS NULL`,
  `UPDATE usage_authorizations
      SET consumed_at = created_at
    WHERE lifecycle_status = 'consumed' AND consumed_at IS NULL`,
  `ALTER TABLE usage_authorizations
     ALTER COLUMN lifecycle_status SET NOT NULL`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS acceptance_id text`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS accepted_at timestamptz`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS acceptance_expires_at timestamptz`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS cancelled_at timestamptz`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS expired_at timestamptz`,
  `ALTER TABLE usage_authorizations
     ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz`,
  `ALTER TABLE usage_authorizations
     DROP CONSTRAINT IF EXISTS usage_authorizations_lifecycle_check`,
  `ALTER TABLE usage_authorizations
     ADD CONSTRAINT usage_authorizations_lifecycle_check
     CHECK (lifecycle_status IN (
       'reserved', 'accepted', 'consumed', 'cancelled', 'rolled_back',
       'denied', 'expired'
     ))`,
  `CREATE TABLE IF NOT EXISTS usage_authorization_events (
     id text PRIMARY KEY,
     authorization_id text NOT NULL,
     user_id text NOT NULL,
     app_id text NOT NULL,
     app_session_id text NOT NULL,
     event_type text NOT NULL CHECK (event_type IN (
       'accepted', 'finalized', 'rolled_back', 'cancelled', 'expired',
       'legacy_consumed', 'auto_rolled_back'
     )),
     acceptance_id text,
     created_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS usage_authorization_events_authorization_idx
     ON usage_authorization_events (authorization_id, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS usage_authorization_events_retention_idx
     ON usage_authorization_events (created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS usage_authorizations_acceptance_idx
     ON usage_authorizations (user_id, app_id, acceptance_id)
     WHERE acceptance_id IS NOT NULL`,
  `DROP INDEX IF EXISTS usage_authorizations_active_reservation_idx`,
  `CREATE INDEX usage_authorizations_active_reservation_idx
     ON usage_authorizations (user_id, app_id, created_at, expires_at)
     WHERE lifecycle_status IN ('reserved', 'accepted', 'consumed')`,
  `CREATE INDEX IF NOT EXISTS admin_audit_log_chronology_idx
     ON admin_audit_log (created_at DESC, id DESC)`,
] as const;

export const DEFAULT_GROK_AUTOMATOR_GUIDE = {
  appId: 'grok-automator',
  content: guideContentSchema.parse({
    schemaVersion: 1,
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        blocks: [
          {
            type: 'paragraph',
            text: 'Grok Automator helps an authorized user prepare and run bounded prompt batches in their own Grok browser session.',
          },
          {
            type: 'callout',
            tone: 'warning',
            title: 'Use an account you control',
            text: 'Review every batch before running it. Do not use the tool for spam, deceptive activity, or activity that violates Grok policies.',
          },
        ],
      },
      {
        id: 'prepare',
        title: 'Before you start',
        blocks: [
          {
            type: 'list',
            style: 'unordered',
            items: [
              'Install the verified Grok Automator extension build.',
              'Sign in with Google through Paks Tools and confirm your access.',
              'Open Grok in the browser profile where the extension is installed.',
              'Prepare a supported spreadsheet and keep an untouched backup copy.',
            ],
          },
        ],
      },
      {
        id: 'run-a-batch',
        title: 'Run a batch',
        blocks: [
          {
            type: 'list',
            style: 'ordered',
            items: [
              'Open the extension and select the spreadsheet you want to use.',
              'Review the parsed prompts, image references, and batch settings.',
              'Keep the target Grok tab open, then start the run once.',
              'Watch the status panel and respond to any pause or confirmation prompt.',
              'Confirm the result and download state before starting another batch.',
            ],
          },
          {
            type: 'callout',
            tone: 'info',
            title: 'Interrupted work',
            text: 'A claimed batch is not automatically replayed after a content-page reload. Review the extension state before deciding whether to submit a new batch.',
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: 'Troubleshooting',
        blocks: [
          {
            type: 'heading',
            level: 3,
            text: 'The run does not start',
          },
          {
            type: 'list',
            style: 'unordered',
            items: [
              'Confirm you are signed in and your license is active.',
              'Reload Grok once, reopen the extension, and review the batch state.',
              'Check that the spreadsheet still meets the displayed size and format limits.',
              'If a download is ambiguous, inspect Chrome Downloads before retrying so you do not create a duplicate.',
            ],
          },
        ],
      },
      {
        id: 'account-and-support',
        title: 'Account and support',
        blocks: [
          {
            type: 'link',
            label: 'Open your Paks Tools account',
            href: '/account',
          },
          {
            type: 'paragraph',
            text: 'When asking for help, share the visible error and app version. Never send cookies, access tokens, Google codes, private spreadsheet contents, or Vercel secrets.',
          },
        ],
      },
    ],
  }),
  slug: 'grok-automator',
  status: 'published',
  summary: 'Install, connect, run, and troubleshoot Grok Automator safely.',
  title: 'Grok Automator guide',
} as const;

const guideCmsStatements: readonly ParameterizedStatement[] = [
  {
    parameters: [],
    text: `CREATE TABLE IF NOT EXISTS admin_identities (
             issuer text NOT NULL,
             subject text NOT NULL,
             user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
             normalized_email text NOT NULL,
             created_at timestamptz NOT NULL,
             PRIMARY KEY (issuer, subject),
             UNIQUE (subject),
             UNIQUE (user_id),
             UNIQUE (normalized_email),
             FOREIGN KEY (issuer, subject)
               REFERENCES google_identities(issuer, subject) ON DELETE RESTRICT,
             CHECK (normalized_email = LOWER(normalized_email))
           )`,
  },
  {
    parameters: [],
    text: `CREATE TABLE IF NOT EXISTS tool_guides (
             slug text PRIMARY KEY,
             app_id text NOT NULL,
             title text NOT NULL,
             summary text NOT NULL,
             status text NOT NULL CHECK (status IN ('draft', 'published')),
             content jsonb NOT NULL,
             revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
             created_at timestamptz NOT NULL,
             updated_at timestamptz NOT NULL,
             published_at timestamptz,
             updated_by text REFERENCES users(id) ON DELETE RESTRICT,
             CHECK (slug ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'),
             CHECK (app_id ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'),
             CHECK (char_length(slug) BETWEEN 3 AND 63),
             CHECK (char_length(app_id) BETWEEN 3 AND 63),
             CHECK (char_length(title) BETWEEN 1 AND 120),
             CHECK (char_length(summary) BETWEEN 1 AND 320),
             CHECK (
               (status = 'published' AND published_at IS NOT NULL) OR
               (status = 'draft' AND published_at IS NULL)
             )
           )`,
  },
  {
    parameters: [],
    text: `CREATE INDEX IF NOT EXISTS tool_guides_admin_order_idx
             ON tool_guides (updated_at DESC, slug ASC)`,
  },
  {
    parameters: [],
    text: `CREATE TABLE IF NOT EXISTS tool_guide_revisions (
             guide_slug text NOT NULL REFERENCES tool_guides(slug) ON DELETE RESTRICT,
             revision integer NOT NULL CHECK (revision >= 0),
             app_id text NOT NULL,
             title text NOT NULL,
             summary text NOT NULL,
             status text NOT NULL CHECK (status IN ('draft', 'published')),
             content jsonb NOT NULL,
             created_at timestamptz NOT NULL,
             published_at timestamptz,
             updated_by text REFERENCES users(id) ON DELETE RESTRICT,
             PRIMARY KEY (guide_slug, revision)
           )`,
  },
  {
    parameters: [],
    text: `CREATE INDEX IF NOT EXISTS tool_guide_revisions_chronology_idx
             ON tool_guide_revisions (guide_slug, revision DESC)`,
  },
  {
    parameters: [
      DEFAULT_GROK_AUTOMATOR_GUIDE.slug,
      DEFAULT_GROK_AUTOMATOR_GUIDE.appId,
      DEFAULT_GROK_AUTOMATOR_GUIDE.title,
      DEFAULT_GROK_AUTOMATOR_GUIDE.summary,
      DEFAULT_GROK_AUTOMATOR_GUIDE.status,
      JSON.stringify(DEFAULT_GROK_AUTOMATOR_GUIDE.content),
    ],
    text: `WITH seeded AS (
             INSERT INTO tool_guides
               (slug, app_id, title, summary, status, content, revision,
                created_at, updated_at, published_at, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0,
                     NOW(), NOW(), NOW(), NULL)
             ON CONFLICT (slug) DO NOTHING
             RETURNING *
           )
           INSERT INTO tool_guide_revisions
             (guide_slug, revision, app_id, title, summary, status, content,
              created_at, published_at, updated_by)
           SELECT slug, revision, app_id, title, summary, status, content,
                  updated_at, published_at, updated_by
             FROM seeded
           UNION ALL
           SELECT slug, revision, app_id, title, summary, status, content,
                  updated_at, published_at, updated_by
             FROM tool_guides
            WHERE slug = $1 AND revision = 0
           ON CONFLICT (guide_slug, revision) DO NOTHING`,
  },
];

const retentionStatements = [
  `WITH changed AS (
     UPDATE usage_authorizations
        SET lifecycle_status = 'rolled_back', rolled_back_at = NOW()
      WHERE lifecycle_status = 'accepted'
        AND acceptance_expires_at <= NOW()
     RETURNING id, user_id, app_id, app_session_id, acceptance_id
   ), audited AS (
     INSERT INTO usage_authorization_events
       (id, authorization_id, user_id, app_id, app_session_id, event_type,
        acceptance_id, created_at)
     SELECT 'retention:' || id, id, user_id, app_id, app_session_id,
            'auto_rolled_back', acceptance_id, NOW()
       FROM changed
     ON CONFLICT (id) DO NOTHING
   )
   SELECT 'rolled_back_usage_acceptances' AS retention_kind,
          COUNT(*)::int AS retained_count FROM changed`,
  `WITH changed AS (
     UPDATE usage_authorizations
        SET lifecycle_status = 'expired', expired_at = NOW()
      WHERE lifecycle_status = 'reserved' AND expires_at <= NOW()
     RETURNING id
   )
   SELECT 'expired_usage_reservations' AS retention_kind,
          COUNT(*)::int AS retained_count FROM changed`,
  `WITH removed AS (
     DELETE FROM google_oauth_flows
      WHERE expires_at < NOW() - INTERVAL '1 day'
         OR consumed_at < NOW() - INTERVAL '1 day'
     RETURNING state_hash
   )
   SELECT 'google_oauth_flows' AS retention_kind,
          COUNT(*)::int AS retained_count FROM removed`,
  `WITH removed AS (
     DELETE FROM extension_auth_flows
      WHERE expires_at < NOW() - INTERVAL '1 day'
         OR (
           status IN ('denied', 'consumed')
           AND COALESCE(consumed_at, denied_at, expires_at) < NOW() - INTERVAL '1 day'
         )
     RETURNING id
   )
   SELECT 'extension_auth_flows' AS retention_kind,
          COUNT(*)::int AS retained_count FROM removed`,
  `WITH removed AS (
     DELETE FROM usage_authorizations
       WHERE lifecycle_status IN (
         'consumed', 'cancelled', 'rolled_back', 'denied', 'expired'
       )
        AND created_at < NOW() - INTERVAL '30 days'
     RETURNING id
   )
   SELECT 'usage_authorizations' AS retention_kind,
          COUNT(*)::int AS retained_count FROM removed`,
  `WITH removed AS (
     DELETE FROM usage_authorization_events
      WHERE created_at < NOW() - INTERVAL '90 days'
     RETURNING id
   )
   SELECT 'usage_authorization_events' AS retention_kind,
          COUNT(*)::int AS retained_count FROM removed`,
  `WITH removed AS (
     DELETE FROM app_sessions
      WHERE (expires_at < NOW() - INTERVAL '30 days')
         OR (revoked_at < NOW() - INTERVAL '30 days')
     RETURNING id
   )
   SELECT 'app_sessions' AS retention_kind,
          COUNT(*)::int AS retained_count FROM removed`,
  `WITH removed AS (
     DELETE FROM web_sessions
      WHERE (expires_at < NOW() - INTERVAL '30 days')
         OR (revoked_at < NOW() - INTERVAL '30 days')
     RETURNING id
   )
   SELECT 'web_sessions' AS retention_kind,
          COUNT(*)::int AS retained_count FROM removed`,
  `WITH removed AS (
     DELETE FROM rate_limit_buckets WHERE expires_at < NOW()
     RETURNING bucket_key
   )
   SELECT 'rate_limit_buckets' AS retention_kind,
          COUNT(*)::int AS retained_count FROM removed`,
] as const;

export function buildRetentionStatements(): readonly string[] {
  return retentionStatements;
}

interface ParameterizedStatement {
  readonly parameters: readonly unknown[];
  readonly text: string;
}

export interface MigrationPlanStatement extends ParameterizedStatement {
  readonly kind: 'lock' | 'migration' | 'retention';
}

export interface MigrationQueryClient {
  query(
    text: string,
    parameters?: readonly unknown[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export function buildBrandRenameMigrationStatement(): ParameterizedStatement {
  return {
    parameters: [
      brandRenameMigrationVersion,
      legacyPlatformDisplayName,
      PLATFORM_DISPLAY_NAME,
    ],
    text: `WITH claimed_migration AS (
             INSERT INTO schema_migrations (version)
             VALUES ($1)
             ON CONFLICT (version) DO NOTHING
             RETURNING version
           ),
           updated_settings AS (
             UPDATE platform_settings
                SET settings = jsonb_set(
                      settings,
                      '{seo}',
                      (settings -> 'seo') ||
                        jsonb_strip_nulls(
                          jsonb_build_object(
                            'siteTitle',
                            CASE
                              WHEN settings #>> '{seo,siteTitle}' = $2
                                THEN to_jsonb($3::text)
                              ELSE NULL
                            END,
                            'openGraphTitle',
                            CASE
                              WHEN settings #>> '{seo,openGraphTitle}' = $2
                                THEN to_jsonb($3::text)
                              ELSE NULL
                            END
                          )
                        ),
                      false
                    ),
                    revision = revision + 1,
                    updated_at = NOW()
              WHERE EXISTS (SELECT 1 FROM claimed_migration)
                AND (
                  settings #>> '{seo,siteTitle}' = $2 OR
                  settings #>> '{seo,openGraphTitle}' = $2
                )
              RETURNING singleton
           )
           SELECT claimed_migration.version
             FROM claimed_migration
             LEFT JOIN updated_settings ON TRUE
            GROUP BY claimed_migration.version`,
  };
}

export const DEFAULT_PLATFORM_SETTINGS = {
  seo: {
    openGraphDescription:
      'Browser automation and digital products for modern content workflows.',
    openGraphTitle: PLATFORM_DISPLAY_NAME,
    siteDescription:
      'Chrome automation extensions and downloadable tools for streamlined content workflows.',
    siteTitle: PLATFORM_DISPLAY_NAME,
    socialImageUrl: null,
  },
  theme: {
    colors: {
      border: '#3A3A3A',
      canvas: '#0A0A0A',
      gold: '#D4AF37',
      ink: '#FFFFFF',
      mutedInk: '#B8B8B8',
      surface: '#1C1C1C',
    },
    fonts: {
      body: 'Manrope',
      display: 'Instrument Serif',
      metadata: 'IBM Plex Mono',
    },
  },
} as const;

const defaultSettings = JSON.stringify(DEFAULT_PLATFORM_SETTINGS);

const appliedRowSchema = z.strictObject({ version: z.string() });
const registryExistsRowSchema = z.strictObject({ exists: z.boolean() });
const retentionRowSchema = z.strictObject({
  retained_count: z.coerce.number().int().nonnegative(),
  retention_kind: z.enum([
    'expired_usage_reservations',
    'rolled_back_usage_acceptances',
    'google_oauth_flows',
    'extension_auth_flows',
    'usage_authorizations',
    'usage_authorization_events',
    'app_sessions',
    'web_sessions',
    'rate_limit_buckets',
  ]),
});

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly currentVersion: string;
  readonly retention: Readonly<Record<string, number>>;
}

function migrationClaim(version: string): MigrationPlanStatement {
  return {
    kind: 'migration',
    parameters: [version],
    text: `INSERT INTO schema_migrations (version)
           VALUES ($1)
           ON CONFLICT (version) DO NOTHING
           RETURNING version`,
  };
}

export function buildMigrationPlan(
  appliedVersions: readonly string[],
): readonly MigrationPlanStatement[] {
  const applied = new Set(appliedVersions);
  const plan: MigrationPlanStatement[] = [
    { kind: 'lock', parameters: [], text: statements[1] },
  ];
  if (!applied.has(baseMigrationVersion)) {
    for (const [index, text] of statements.entries()) {
      if (index === 1) continue;
      plan.push({
        kind: 'migration',
        parameters: index === 12 ? [defaultSettings] : [],
        text,
      });
    }
    plan.push(migrationClaim(baseMigrationVersion));
  }
  if (!applied.has(extensionMigrationVersion)) {
    plan.push(
      ...extensionStatements.map((text) => ({
        kind: 'migration' as const,
        parameters: [],
        text,
      })),
      migrationClaim(extensionMigrationVersion),
    );
  }
  if (!applied.has(brandRenameMigrationVersion)) {
    const brandRename = buildBrandRenameMigrationStatement();
    plan.push({ ...brandRename, kind: 'migration' });
  }
  if (!applied.has(securityLifecycleMigrationVersion)) {
    plan.push(
      ...securityLifecycleStatements.map((text) => ({
        kind: 'migration' as const,
        parameters: [],
        text,
      })),
      migrationClaim(securityLifecycleMigrationVersion),
    );
  }
  if (!applied.has(guideCmsMigrationVersion)) {
    plan.push(
      ...guideCmsStatements.map((statement) => ({
        ...statement,
        kind: 'migration' as const,
      })),
      migrationClaim(guideCmsMigrationVersion),
    );
  }
  plan.push(
    ...retentionStatements.map((text) => ({
      kind: 'retention' as const,
      parameters: [],
      text,
    })),
  );
  return plan;
}

export async function executeLockedMigrationPlan(
  client: MigrationQueryClient,
): Promise<readonly (readonly unknown[])[]> {
  await client.query(statements[1], []);
  const registryResult = await client.query(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
    [],
  );
  const registryExists = registryExistsRowSchema.parse(
    registryResult.rows[0],
  ).exists;
  const appliedVersions = registryExists
    ? appliedRowSchema
        .array()
        .parse(
          (await client.query('SELECT version FROM schema_migrations', []))
            .rows,
        )
        .map(({ version }) => version)
    : [];
  const results: (readonly unknown[])[] = [];
  for (const statement of buildMigrationPlan(appliedVersions)) {
    if (statement.kind === 'lock') continue;
    const result = await client.query(statement.text, statement.parameters);
    results.push(result.rows);
  }
  return results;
}

export async function runNeonMigrations(
  environment: NodeJS.ProcessEnv,
): Promise<MigrationResult> {
  const { databaseUrl } = parseDatabaseConfig(environment);
  const pool = new Pool({
    allowExitOnIdle: true,
    connectionString: databaseUrl,
    max: 1,
  });
  const client = await pool.connect();
  let transactionStarted = false;
  let results: readonly (readonly unknown[])[];
  try {
    // The advisory-lock statement can wait behind another runner. READ COMMITTED
    // gives the following registry read a fresh, post-lock snapshot; SERIALIZABLE
    // could retain the snapshot from before the wait and plan stale migrations.
    await client.query(MIGRATION_TRANSACTION_BEGIN);
    transactionStarted = true;
    results = await executeLockedMigrationPlan(client);
    await client.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  const applied = results.flatMap((rows) => {
    const parsed = appliedRowSchema.array().safeParse(rows);
    return parsed.success ? parsed.data : [];
  });
  const retention = Object.fromEntries(
    results.flatMap((rows) => {
      const parsed = retentionRowSchema.array().safeParse(rows);
      return parsed.success
        ? parsed.data.map(({ retained_count, retention_kind }) => [
            retention_kind,
            retained_count,
          ])
        : [];
    }),
  );
  return {
    applied: applied.map(({ version }) => version),
    currentVersion: CURRENT_MIGRATION_VERSION,
    retention,
  };
}
