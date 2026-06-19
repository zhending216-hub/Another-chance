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
- `Tachi` and `Illustration` are stored and exported as package assets without forcing node placement.
- AIVN installable folder and zip export are first-class UI actions.

## Safety notes

- No Prisma migration was needed.
- No bulk corpus persist was performed.
- Original `Story`, `StorySegment`, and `StoryBranch` rows are not modified by this UI workflow.
- Image generation failures remain nonblocking for text-only VNGraph.
