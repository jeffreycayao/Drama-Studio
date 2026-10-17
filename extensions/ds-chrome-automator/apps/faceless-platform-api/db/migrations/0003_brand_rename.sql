BEGIN;

SELECT pg_advisory_xact_lock(704219001);

WITH claimed_migration AS (
  INSERT INTO schema_migrations (version)
  VALUES ('0003_brand_rename')
  ON CONFLICT (version) DO NOTHING
  RETURNING version
),
updated_settings AS (
  UPDATE platform_settings
  SET
    settings = jsonb_set(
      settings,
      '{seo}',
      (settings -> 'seo') ||
        jsonb_strip_nulls(
          jsonb_build_object(
            'siteTitle',
            CASE
              WHEN settings #>> '{seo,siteTitle}' = 'Faceless Automations'
                THEN to_jsonb('Paks Tools Faceless automations'::text)
              ELSE NULL
            END,
            'openGraphTitle',
            CASE
              WHEN settings #>> '{seo,openGraphTitle}' = 'Faceless Automations'
                THEN to_jsonb('Paks Tools Faceless automations'::text)
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
      settings #>> '{seo,siteTitle}' = 'Faceless Automations'
      OR settings #>> '{seo,openGraphTitle}' = 'Faceless Automations'
    )
  RETURNING singleton
)
SELECT claimed_migration.version
FROM claimed_migration
LEFT JOIN updated_settings ON TRUE
GROUP BY claimed_migration.version;

COMMIT;
