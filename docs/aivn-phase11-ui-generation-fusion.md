# Phase 11: AIVN UI generation fusion

Date: 2026-06-19

## Scope

- Wire story UI VN workflow to `/api/stories/[id]/aivn-generate`.
- Keep prose continuation routes unchanged.
- Let server generate, validate, store, and export AIVN-compatible data only.
- Let local AIVN/Godot remain the import/load/play runtime.

## UI behavior

- `VNChapterPanel` now supports fused AIVN preview and persist.
- Preview uses strict AIVN validation without writing a `GeneratedVNChapter`.
- Persist saves a `GeneratedVNChapter` with existing fused generation metadata.
- Chapter asset generation is exposed for `Background`, `Tachi`, and `Illustration`.
- `Background` writes back to the graph when validation succeeds.
- `Tachi` and `Illustration` are stored, exported, and automatically attached to Dialogue/Paragraph `Actions` when validation succeeds.
- AIVN installable folder and zip export are first-class UI actions.

## Safety notes

- No Prisma migration was needed.
- No bulk corpus persist was performed.
- Original `Story`, `StorySegment`, and `StoryBranch` rows are not modified by this UI workflow.
- Image generation failures remain nonblocking for text-only VNGraph.

## Phase 12 visual orchestration update

- `src/lib/vn/visual-orchestration.ts` adds deterministic visual action planning.
- Tachi assets create `Action:Sequence` + `Action:Tachi` nodes on each Dialogue/Paragraph target.
- Illustration assets create `Action:Sequence` + `Action:Art` nodes on each Dialogue/Paragraph target.
- Existing progression exits are not rewired; visual nodes are only attached through `Actions`.
- Re-running the same asset orchestration is idempotent per target node.
