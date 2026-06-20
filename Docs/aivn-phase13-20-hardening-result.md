# AIVN Phase 13-20 Hardening Result

> Date: 2026-06-20
> Server: `/home/workspace/fengbohan/Another-chance`
> Branch: `fix/name-correction-and-misc-fixes`
> Scope: harden the visual package, placement, image-quality metadata, local playback smoke, visual backfill guardrails, and quality reporting boundary after Phase 12.

## Current Boundary

The fused AIVN pipeline is implemented and verified through code-level, package-level, and local AIVN smoke gates.

Implemented:

- Phase 13 durable visual package smoke coverage.
- Phase 14 smart placement policy.
- Phase 16 image quality contract metadata.
- Phase 17 local deterministic visual playback smoke in the AIVN project.
- Phase 18 audit/dry-run/persist-existing/rollback-report tooling.
- Phase 19 corpus quality reporting.

Not completed as a release lock:

- No server push was performed.
- No final tag was created.
- No final database backup was taken during this hardening pass.
- No real image-provider batch generation was run.
- No bulk visual backfill rows were persisted.
- No generated package, report, image, dump, or secret was committed.

## Commits

Server commits:

```text
48629e0 feat(vn): add smart visual placement policy
d8b1d0c test(vn): smoke visual AIVN package orchestration
4e52fdd feat(vn): fuse AIVN image quality constraints
82af5ca feat(vn): add fusion quality reporting
```

Local AIVN commit:

```text
9431ed3 test(vn): verify local visual playback package semantics
```

## Functional Result

Visual placement now plans before graph mutation:

- Tachi placement prefers speaker-aware dialogue targets.
- Illustration placement is selective and event-aware.
- Clear/reset actions use existing local schema/runtime action nodes.
- Placement reports include reason, confidence, and clear-before information.
- Graph validation remains the final gate.
- `Outputs.Next` is not rewired.

Visual package smoke now covers:

- `Action:Sequence`.
- `Action:Tachi`.
- `Action:Art`.
- `TachiIamge` and `IllustrationImage` `assets:*` references.
- `assets_manifest.json` entries.
- `Objects/sha256_{hash}.{ext}` object files.

Image quality fusion now records a pure contract for accepted image previews:

- category;
- prompt version;
- provider/model labels;
- source hash;
- validation status;
- retry count;
- warnings/fallback reason.

The contract does not require a Prisma migration.

Backfill tooling is guarded:

- `--audit` is read-only.
- `--dry-run` is read-only.
- `--persist-existing` refuses to run unless `--confirm-backed-up` is present.
- rollback uses a previous graph snapshot from a persist report.
- original `Story`, `StorySegment`, and `StoryBranch` rows are not targets.

Quality reporting now produces JSON and optional Markdown under ignored `exports/`.

## Verification

Server regression:

```text
npx vitest run tests/vn-visual-orchestration.test.ts tests/vn-ui-workflow.test.ts tests/vn-aivn-package-assets.test.ts tests/vn-aivn-package.test.ts tests/vn-fused-generation-service.test.ts tests/vn-asset-generation-service.test.ts tests/vn-asset-bridge.test.ts tests/vn-prompt-builder.test.ts tests/vn-generation-service.test.ts tests/generation-context.test.ts tests/generation-contracts.test.ts tests/vn-graph-validator.test.ts tests/vn-export-package.test.ts tests/vn-storage.test.ts tests/vn-tree-migration.test.ts tests/vn-bulk-migration.test.ts tests/vn-migration-run.test.ts tests/vn-phase9-skipped-migration.test.ts tests/vn-fusion-quality-report.test.ts
```

Result:

```text
19 test files passed / 73 tests passed
```

TypeScript:

```text
npx tsc --noEmit --pretty false
```

Result:

```text
scripts/test-prompt-generation.ts(97,9): error TS2353: Object literal may only specify known properties, and 'pauseAfterParagraph' does not exist in type 'PacingConfig'.
```

This is the known pre-existing non-VN baseline issue.

Local AIVN smoke:

```text
$env:AIVN_TEST_FILTER='Gushi'; dotnet run --project D:\projects\AIVN_VN\code\aivn\Tests\AIVN.Tests\AIVN.Tests.csproj
```

Result:

```text
Running 1 tests...
[PASS] GushiPackageImportSmokeTests.GushiExportedPackagesLoadManifestGraphsAndTerminalEnds
All 1 tests passed. 0 skipped.
```

## Reports

Ignored server reports:

```text
exports/aivn-migration/reports/phase18-visual-audit-20260619-final.json
exports/aivn-migration/reports/phase18-visual-dry-run-20260619-final.json
exports/aivn-migration/reports/phase19-quality-summary-20260619-final.json
exports/aivn-migration/reports/phase19-quality-summary-20260619-final.md
```

Phase 18 final audit/dry-run:

```json
{
  "chapterCount": 40,
  "eligibleCount": 0,
  "persistedCount": 0,
  "skippedCount": 40,
  "rollbackCount": 0
}
```

The skip result is expected because the current corpus has `GeneratedAsset=0`; there are no existing visual assets to backfill.

Phase 19 final quality summary:

```json
{
  "storyCount": 37,
  "chapterCount": 40,
  "assetCount": 0,
  "validGraphCount": 40,
  "invalidGraphCount": 0,
  "readyChapterCount": 40,
  "failureCount": 0
}
```

Thresholds:

```json
{
  "eligibleStoriesClassified": true,
  "persistedGraphsValidate": true,
  "referencedAssetsResolve": true,
  "objectFilesComplete": true,
  "failuresClassified": true
}
```

## Remaining Release Steps

To complete Phase 20, perform these in order:

1. Re-check server status:

```text
cd /home/workspace/fengbohan/Another-chance
git status --short --branch
```

2. Take and verify a fresh database backup.
3. Re-run server VN regression and local Gushi smoke.
4. Push server and local commits.
5. Create and push final server tag:

```text
aivn-fusion-phase20-final-YYYYMMDD-HHMMSS
```

6. Record the final backup path, pushed commit ids, tag, and residual risks in the reference pack.

