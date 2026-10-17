BEGIN ISOLATION LEVEL READ COMMITTED;

SELECT pg_advisory_xact_lock(704219001);

CREATE TABLE IF NOT EXISTS admin_identities (
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
);

CREATE TABLE IF NOT EXISTS tool_guides (
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
);

CREATE INDEX IF NOT EXISTS tool_guides_admin_order_idx
  ON tool_guides (updated_at DESC, slug ASC);

CREATE TABLE IF NOT EXISTS tool_guide_revisions (
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
);

CREATE INDEX IF NOT EXISTS tool_guide_revisions_chronology_idx
  ON tool_guide_revisions (guide_slug, revision DESC);

WITH seeded AS (
  INSERT INTO tool_guides
    (slug, app_id, title, summary, status, content, revision,
     created_at, updated_at, published_at, updated_by)
  VALUES (
    'grok-automator',
    'grok-automator',
    'Grok Automator guide',
    'Install, connect, run, and troubleshoot Grok Automator safely.',
    'published',
    '{"schemaVersion":1,"sections":[{"id":"overview","title":"Overview","blocks":[{"type":"paragraph","text":"Grok Automator helps an authorized user prepare and run bounded prompt batches in their own Grok browser session."},{"type":"callout","tone":"warning","title":"Use an account you control","text":"Review every batch before running it. Do not use the tool for spam, deceptive activity, or activity that violates Grok policies."}]},{"id":"prepare","title":"Before you start","blocks":[{"type":"list","style":"unordered","items":["Install the verified Grok Automator extension build.","Sign in with Google through Paks Tools and confirm your access.","Open Grok in the browser profile where the extension is installed.","Prepare a supported spreadsheet and keep an untouched backup copy."]}]},{"id":"run-a-batch","title":"Run a batch","blocks":[{"type":"list","style":"ordered","items":["Open the extension and select the spreadsheet you want to use.","Review the parsed prompts, image references, and batch settings.","Keep the target Grok tab open, then start the run once.","Watch the status panel and respond to any pause or confirmation prompt.","Confirm the result and download state before starting another batch."]},{"type":"callout","tone":"info","title":"Interrupted work","text":"A claimed batch is not automatically replayed after a content-page reload. Review the extension state before deciding whether to submit a new batch."}]},{"id":"troubleshooting","title":"Troubleshooting","blocks":[{"type":"heading","level":3,"text":"The run does not start"},{"type":"list","style":"unordered","items":["Confirm you are signed in and your license is active.","Reload Grok once, reopen the extension, and review the batch state.","Check that the spreadsheet still meets the displayed size and format limits.","If a download is ambiguous, inspect Chrome Downloads before retrying so you do not create a duplicate."]}]},{"id":"account-and-support","title":"Account and support","blocks":[{"type":"link","label":"Open your Paks Tools account","href":"/account"},{"type":"paragraph","text":"When asking for help, share the visible error and app version. Never send cookies, access tokens, Google codes, private spreadsheet contents, or Vercel secrets."}]}]}'::jsonb,
    0,
    NOW(),
    NOW(),
    NOW(),
    NULL
  )
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
 WHERE slug = 'grok-automator' AND revision = 0
ON CONFLICT (guide_slug, revision) DO NOTHING;

INSERT INTO schema_migrations (version)
VALUES ('0005_guide_cms')
ON CONFLICT (version) DO NOTHING;

COMMIT;
