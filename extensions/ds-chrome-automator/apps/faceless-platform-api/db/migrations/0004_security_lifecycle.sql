BEGIN;

SELECT pg_advisory_xact_lock(704219001);

ALTER TABLE extension_auth_flows
  ADD COLUMN IF NOT EXISTS protocol_version smallint NOT NULL DEFAULT 1;
DO $$
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
$$;

ALTER TABLE extension_auth_flows
  ADD COLUMN IF NOT EXISTS allocation_key char(64);
UPDATE extension_auth_flows
  SET allocation_key = repeat('0', 64)
  WHERE allocation_key IS NULL;
ALTER TABLE extension_auth_flows
  ALTER COLUMN allocation_key SET NOT NULL;

ALTER TABLE extension_auth_flows
  ADD COLUMN IF NOT EXISTS user_code_hash char(64);
UPDATE extension_auth_flows
  SET user_code_hash = repeat('0', 64)
  WHERE user_code_hash IS NULL;
ALTER TABLE extension_auth_flows
  ALTER COLUMN user_code_hash SET NOT NULL;

ALTER TABLE extension_auth_flows
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE extension_auth_flows
  ADD COLUMN IF NOT EXISTS initiator_verified_at timestamptz;

DO $$
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
$$;

CREATE INDEX IF NOT EXISTS extension_auth_flows_allocation_idx
  ON extension_auth_flows (allocation_key, expires_at)
  WHERE status IN ('pending', 'authorized');

ALTER TABLE google_oauth_flows
  ADD COLUMN IF NOT EXISTS allocation_key char(64);
UPDATE google_oauth_flows
  SET allocation_key = repeat('0', 64)
  WHERE allocation_key IS NULL;
ALTER TABLE google_oauth_flows
  ALTER COLUMN allocation_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS google_oauth_flows_allocation_idx
  ON google_oauth_flows (allocation_key, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key char(64) NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  request_limit integer NOT NULL CHECK (request_limit > 0),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, window_started_at)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx
  ON rate_limit_buckets (expires_at);

ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS lifecycle_status text;
ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS protocol_version smallint NOT NULL DEFAULT 1;
DO $$
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
$$;
UPDATE usage_authorizations
  SET lifecycle_status = CASE WHEN allowed THEN 'consumed' ELSE 'denied' END
  WHERE lifecycle_status IS NULL;
UPDATE usage_authorizations
  SET consumed_at = created_at
  WHERE lifecycle_status = 'consumed' AND consumed_at IS NULL;
ALTER TABLE usage_authorizations
  ALTER COLUMN lifecycle_status SET NOT NULL;
ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS acceptance_id text;
ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS acceptance_expires_at timestamptz;
ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;
ALTER TABLE usage_authorizations
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz;

ALTER TABLE usage_authorizations
  DROP CONSTRAINT IF EXISTS usage_authorizations_lifecycle_check;
ALTER TABLE usage_authorizations
  ADD CONSTRAINT usage_authorizations_lifecycle_check
  CHECK (lifecycle_status IN (
    'reserved', 'accepted', 'consumed', 'cancelled', 'rolled_back',
    'denied', 'expired'
  ));

CREATE TABLE IF NOT EXISTS usage_authorization_events (
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
);

CREATE INDEX IF NOT EXISTS usage_authorization_events_authorization_idx
  ON usage_authorization_events (authorization_id, created_at, id);
CREATE INDEX IF NOT EXISTS usage_authorization_events_retention_idx
  ON usage_authorization_events (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS usage_authorizations_acceptance_idx
  ON usage_authorizations (user_id, app_id, acceptance_id)
  WHERE acceptance_id IS NOT NULL;
DROP INDEX IF EXISTS usage_authorizations_active_reservation_idx;
CREATE INDEX usage_authorizations_active_reservation_idx
  ON usage_authorizations (user_id, app_id, created_at, expires_at)
  WHERE lifecycle_status IN ('reserved', 'accepted', 'consumed');
CREATE INDEX IF NOT EXISTS admin_audit_log_chronology_idx
  ON admin_audit_log (created_at DESC, id DESC);

INSERT INTO schema_migrations (version)
VALUES ('0004_security_lifecycle')
ON CONFLICT (version) DO NOTHING;

COMMIT;
