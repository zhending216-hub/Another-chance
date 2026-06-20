# Scripts Map

Scripts in this folder are operational tools. Prefer the package scripts in `package.json` when one exists.

## Release And Database

- `backup-db.sh` - create/list/restore PostgreSQL dumps under ignored `backups/`.
- `validate-migration.ts` - migration validation helper.

Package entry points:

```text
npm run db:backup
npm run db:backups
npm run db:restore
```

## AIVN/VN

- `migrate-story-to-vn-sample.ts` - sample story-to-VN migration.
- `migrate-stories-to-vn-bulk.ts` - bulk VN migration.
- `migrate-phase9-skipped-stories.ts` - strict skipped-story recovery.
- `backfill-aivn-visuals.ts` - visual backfill audit/dry-run/persist-existing tool.
- `report-aivn-fusion-quality.ts` - JSON/Markdown quality reporting.

Package entry points:

```text
npm run test:vn
npm run test:aivn-package
npm run aivn:backfill:audit
npm run aivn:backfill:dry-run
npm run aivn:quality-report -- --out exports/aivn-migration/reports/<file>.json
```

Do not run a persist/backfill command unless a fresh verified database backup and rollback target are recorded.

## Data Import And Legacy Migration

- `migrate-json-to-pg.ts`
- `import-json-to-db.ts`
- `migrate-data.js`
- `migrate-chronosmirror.js`
- `regenerate-covers.ts`

These scripts may write application data. Treat them as migration tools, not routine release gates.

## Manual Diagnostics And Smoke Scripts

Standalone diagnostics:

- `diagnose-genre.ts`
- `test-auth.ts`
- `test-continue.ts`
- `test-cover.js`
- `test-image-gen.ts`
- `test-plausibility.ts`
- `test-prompt-generation.ts`
- `stress-test-story.ts`

Historical smoke scripts moved out of `tests/`:

```text
scripts/manual-smoke/
```

These are manual tools and may call external services or depend on local data. They are not part of `npm run test:vn`.

## Mobile And Ops

- `init-capacitor.sh`
- `setup-docker-build.sh`
- `start-dev.sh`
- `claude-chats.sh`

Keep new one-off scripts documented here when adding them.