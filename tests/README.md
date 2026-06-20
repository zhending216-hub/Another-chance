# Tests Map

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

## Legacy Manual Smoke Files

These files currently live under `tests/` but are not clean Vitest suites:

- `branch-memory.test.ts`
- `consistency-checker.test.ts`
- `context-summarizer.test.ts`
- `e2e.test.ts`
- `event-tracker.test.ts`

They should either be converted into standard `describe`/`test` suites or moved to a manual smoke-script folder in a separate cleanup pass. Do not include them in the Phase 20 AIVN release gate until converted.

## Full Test Caveat

`npx vitest run` may still pick up historical manual smoke files. Use targeted package scripts for release decisions until those files are normalized.
