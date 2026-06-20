# Manual Smoke Scripts

This folder contains historical smoke scripts that are useful for manual checks but are not Vitest suites.

They were moved out of `tests/` so `npx vitest run` only discovers automated tests.

## Scripts

```text
npx tsx scripts/manual-smoke/branch-memory-smoke.ts
npx tsx scripts/manual-smoke/consistency-checker-smoke.ts
npx tsx scripts/manual-smoke/context-summarizer-smoke.ts
npx tsx scripts/manual-smoke/context-memory-e2e-smoke.ts
npx tsx scripts/manual-smoke/event-tracker-smoke.ts
```

## Safety Notes

- These scripts print to stdout and may call `process.exit`.
- Some scripts touch application services that may read local data.
- Do not treat this folder as a release gate.
- Convert a script into a real `describe`/`test` Vitest suite before moving it back to `tests/`.