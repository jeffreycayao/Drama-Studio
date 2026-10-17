BEGIN;

SELECT pg_advisory_xact_lock(704219001);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  last_login_at timestamptz,
  banned_at timestamptz,
  ban_reason text
);

CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);

CREATE TABLE IF NOT EXISTS google_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_login_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issuer, subject)
);

CREATE INDEX IF NOT EXISTS google_identities_user_id_idx ON google_identities (user_id);

CREATE TABLE IF NOT EXISTS web_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS web_sessions_user_active_idx
  ON web_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS google_oauth_flows (
  state_hash char(64) PRIMARY KEY,
  nonce_hash char(64) NOT NULL,
  encrypted_code_verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS google_oauth_flows_expiry_idx ON google_oauth_flows (expires_at);

CREATE TABLE IF NOT EXISTS platform_settings (
  singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by text REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO platform_settings (singleton, revision, settings)
VALUES (
  TRUE,
  0,
  '{
    "seo": {
      "siteTitle": "Paks Tools Faceless automations",
      "siteDescription": "Chrome automation extensions and downloadable tools for streamlined content workflows.",
      "openGraphTitle": "Paks Tools Faceless automations",
      "openGraphDescription": "Browser automation and digital products for modern content workflows.",
      "socialImageUrl": null
    },
    "theme": {
      "colors": {
        "canvas": "#0A0A0A",
        "surface": "#1C1C1C",
        "ink": "#FFFFFF",
        "mutedInk": "#B8B8B8",
        "border": "#3A3A3A",
        "gold": "#D4AF37"
      },
      "fonts": {
        "display": "Instrument Serif",
        "body": "Manrope",
        "metadata": "IBM Plex Mono"
      }
    }
  }'::jsonb
)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS entitlements (
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
);

CREATE INDEX IF NOT EXISTS entitlements_user_status_idx ON entitlements (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_source_reference_idx
  ON entitlements (source, source_reference)
  WHERE source_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id text PRIMARY KEY,
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON admin_audit_log (target_type, target_id);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  failure_code text
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_pending_idx
  ON stripe_webhook_events (received_at)
  WHERE status = 'pending';

INSERT INTO schema_migrations (version)
VALUES ('0001_initial')
ON CONFLICT (version) DO NOTHING;

COMMIT;
