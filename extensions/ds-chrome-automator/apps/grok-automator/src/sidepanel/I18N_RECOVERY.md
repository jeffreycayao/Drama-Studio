# Translation catalog migration

The signed 2.6.3 side-panel bundle contained the original 20-language catalog.
The compiled distribution and decompiler output were intentionally removed when
the project moved into the monorepo; this file retains the verified catalog
contract and migration requirements needed for future source work.

The maintainable UI currently uses the editable English catalog in `i18n.ts`.
`RECOVERED_LOCALES` retains the original 20-locale contract, while
`ACTIVE_LOCALES` intentionally exposes only English so the selector never
promises untranslated copy. A previously stored recovered locale safely resolves
to English until its catalog is migrated. Document `lang` and `dir` are applied
through one helper during initialization and later locale changes; Arabic and
Urdu RTL behavior remains covered for the future catalog import.

A future catalog migration should extract only the locale object (not the
adjacent Vue-i18n/SheetJS vendor code), normalize it to
`Record<RecoveredLocale, MessageCatalog>`, validate every locale against the
English key set, add complete locales to `ACTIVE_LOCALES`, and then switch `t()`
to the selected catalog. A future migration requires an owner-provided backup of
the original catalog because compiled artifacts are no longer retained here.
