# AIVN/Gushi Fusion Docs

This folder contains the server-side AIVN/Gushi fusion records that still matter after the Phase 20 release boundary.

## Files

- `phase11-ui-generation-fusion.md` - UI generation fusion plan/result notes.
- `phase13-20-hardening-result.md` - implementation and hardening result for Phase 13-20.
- `phase20-final-release-result.md` - final backup, verification, report, push, and tag boundary.

## Current Boundary

```text
branch: fix/name-correction-and-misc-fixes
final commit: e2534c6 docs(vn): record final AIVN fusion boundary
final tag: aivn-fusion-phase20-final-20260620-165304
```

The current release is ready for text-only AIVN package consumption. Real image-provider batch generation and corpus-wide visual backfill have not been run.

## Protected Invariants

- Do not rewrite original `Story`, `StorySegment`, or `StoryBranch` rows.
- Keep prose continuation routes independent from AIVN VNGraph generation.
- Image failures must not block a text-only VNGraph.
- Reports and generated packages belong under ignored `exports/`.
- Run `git status --short --branch` before every server-side change.
