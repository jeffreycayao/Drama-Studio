BEGIN;

SELECT pg_advisory_xact_lock(704219001);

CREATE TABLE IF NOT EXISTS extension_auth_flows (
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
);

CREATE INDEX IF NOT EXISTS extension_auth_flows_expiry_idx
  ON extension_auth_flows (expires_at);
CREATE INDEX IF NOT EXISTS extension_auth_flows_user_idx
  ON extension_auth_flows (user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE google_oauth_flows
  ADD COLUMN IF NOT EXISTS client text NOT NULL DEFAULT 'dashboard';
ALTER TABLE google_oauth_flows
  ADD COLUMN IF NOT EXISTS extension_flow_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'google_oauth_flows_client_check'
      AND conrelid = 'google_oauth_flows'::regclass
  ) THEN
    ALTER TABLE google_oauth_flows
      ADD CONSTRAINT google_oauth_flows_client_check
      CHECK (client IN ('dashboard', 'extension'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
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
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'google_oauth_flows_extension_flow_fk'
      AND conrelid = 'google_oauth_flows'::regclass
  ) THEN
    ALTER TABLE google_oauth_flows
      ADD CONSTRAINT google_oauth_flows_extension_flow_fk
      FOREIGN KEY (extension_flow_id)
      REFERENCES extension_auth_flows(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS google_oauth_flows_extension_flow_idx
  ON google_oauth_flows (extension_flow_id)
  WHERE extension_flow_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  extension_origin text NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS app_sessions_user_active_idx
  ON app_sessions (user_id, app_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS usage_authorizations (
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
      'entitlement_required',
      'quota_exhausted',
      'app_disabled',
      'operation_disabled'
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
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
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
$$;

CREATE INDEX IF NOT EXISTS usage_authorizations_daily_idx
  ON usage_authorizations (user_id, app_id, created_at)
  WHERE allowed;
CREATE INDEX IF NOT EXISTS usage_authorizations_expiry_idx
  ON usage_authorizations (expires_at);

INSERT INTO schema_migrations (version)
VALUES ('0002_extension_platform')
ON CONFLICT (version) DO NOTHING;

COMMIT;
