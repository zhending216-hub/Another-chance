# Tests Map

The `tests/` directory is reserved for automated Vitest suites.

The reliable automated release gate for the AIVN/Gushi fusion is:

```text
npm run test:vn
```

For package/export-only checks:

```text
npm run test:aivn-package
```

## VN Test Groups

- `vn-graph-validator.test.ts` - VNGraph schema/runtime validation.
- `vn-generation-service.test.ts`, `vn-fused-generation-service.test.ts`, `vn-prompt-builder.test.ts` - graph generation and repair.
- `vn-storage.test.ts`, `vn-export-package.test.ts`, `vn-aivn-package*.test.ts` - persistence and package export.
- `vn-asset-bridge.test.ts`, `vn-asset-generation-service.test.ts`, `vn-visual-orchestration.test.ts` - generated assets and visual actions.
- `vn-tree-migration.test.ts`, `vn-bulk-migration.test.ts`, `vn-migration-run.test.ts`, `vn-phase9-skipped-migration.test.ts` - migration gates.
- `vn-fusion-quality-report.test.ts` - corpus-level quality report logic.

## Manual Smoke Scripts

The historical non-Vitest smoke files were moved to:

```text
scripts/manual-smoke/
```

They should stay there unless converted into standard `describe`/`test` suites.

## Full Test Gate

After Batch 1 cleanup, `npx vitest run` should only discover real Vitest test files.