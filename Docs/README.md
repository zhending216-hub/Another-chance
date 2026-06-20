# Project Documentation Map

This directory is the canonical documentation root for the server codebase.

## Current Codebase Shape

- `src/app/` - Next.js App Router pages and API routes.
- `src/components/` - React UI components.
- `src/lib/` - application services shared by routes and components.
- `src/lib/vn/` - AIVN/Gushi VNGraph generation, validation, asset packaging, migration, reporting, and visual orchestration.
- `src/types/` - shared TypeScript types.
- `prisma/` - Prisma schema, migrations, and seed code for the PostgreSQL-backed runtime.
- `scripts/` - operational scripts. See `scripts/README.md` before running one manually.
- `tests/` - Vitest tests and a small number of historical manual smoke scripts. See `tests/README.md`.
- `data/` - legacy JSON seed/import data, not the current production runtime database.
- `exports/` - generated AIVN packages and reports. Ignored by git.
- `backups/` - local database dumps. Ignored by git.
- `android/` - Capacitor Android shell.

## AIVN/Gushi Fusion Docs

The release boundary and hardening notes are grouped under `Docs/aivn/`:

- `Docs/aivn/phase11-ui-generation-fusion.md`
- `Docs/aivn/phase13-20-hardening-result.md`
- `Docs/aivn/phase20-final-release-result.md`

The final Phase 20 boundary is:

```text
aivn-fusion-phase20-final-20260620-165304
```

It is a text-only AIVN package release boundary. Visual generation and bulk visual backfill remain guarded but intentionally unrun for the current corpus because `GeneratedAsset=0`.

## Release Gates

Use package scripts instead of copying long command lines:

```text
npm run typecheck
npm run test:vn
npm run test:aivn-package
```

Quality reporting writes to ignored `exports/` paths:

```text
npm run aivn:quality-report -- --out exports/aivn-migration/reports/<file>.json --markdown exports/aivn-migration/reports/<file>.md
```

## Cleanup Plan

- [codebase-cleanup-plan.md](architecture/codebase-cleanup-plan.md) - phased cleanup analysis and execution order.

## Cleanup Boundaries

Safe cleanup targets:

- split oversized UI pages into panels/hooks;
- move historical manual smoke scripts out of `tests/` after replacing them with real Vitest assertions;
- reduce `as any` usage at route/service boundaries;
- replace production `console.log` traces with gated logging.

Do not combine those refactors with migration, database writes, or visual backfill persistence.
