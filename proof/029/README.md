# Proof 029 — Native V8/libuv materializer

## TL;DR

Replace the controlled JS target loader with a lower-level target-native materializer. This is **not** runtime-aware snapshot/restore, not a Node profile, and not app-level import/export. The target must rebuild enough V8/libuv state through native target mechanisms.

## Track objective

The actual goal is to replace fixture-specific JS target loaders with a target-native materializer that consumes portable source-state IR and raw evidence. This is still semantic reconstruction, not raw VM or process restore. The proof must fail closed until native V8/libuv materialization can rebuild the target state without app export/import, selected-state descriptors, source ISA emulation, or sidecar replay.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/029/`. The proof smoke test may be written in TypeScript, for example `proof/029/smoke.ts`, with an optional `proof/029/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/029/smoke.ts`.

## Status

Proof-local starter files are scaffolded:

- `proof/029/source-app.mjs` — counter fixture that future native materialization should reconstruct.
- `proof/029/guest-capture.zig` — Zig guest capture tool matching the source-state capture shape used by prior proofs.
- `proof/029/native-materializer.zig` — fail-closed native materializer boundary stub with a stable not-implemented refusal.
- `proof/029/smoke.ts` — scaffold smoke that compiles/runs the native materializer stub and asserts it does not use the controlled JS loader path.
- `proof/029/smoke.sh` — compatibility wrapper.

This proof is not complete. The current smoke only proves the native materializer boundary fails closed until real V8/libuv materialization is implemented.

## Goal

Move target materialization closer to real runtime internals by using V8 inspector/debugger-like hooks, Node embedder/internal V8 APIs, or a native continuation trampoline. The proof should still use captured source-state IR and target-native execution only.

## Tasks

- [x] Define the initial target-native materialization API boundary as a native binary that consumes source-state IR and emits materialization/refusal evidence.
- [ ] Choose one implementation path:
  - V8 inspector/debugger-style heap injection,
  - Node embedder/internal V8 APIs,
  - or a native V8/libuv trampoline.
- [ ] Recreate the JS counter cell/object in target-native V8 without a fixture-specific JS loader.
- [ ] Recreate or bind the target-native libuv TCP listener handle.
- [ ] Enter the target-native event loop.
- [x] Refuse unsupported native materialization with a stable fail-closed code until the implementation path is chosen.
- [ ] Refuse unsupported V8 layouts, unsupported object kinds, multiple isolates, workers, native addons, active requests, or unknown libuv handles.

## Validation

- [ ] Add unit tests for the materialization plan and refusal matrix.
- [x] Run the native materializer boundary scaffold, e.g. `pnpm exec tsx proof/029/smoke.ts`.
- [ ] Assert source returns `{count:1}`, `{count:2}` before capture.
- [ ] Assert target-native materializer reconstructs state and first target request returns `{count:3}`.
- [x] Assert no controlled JS loader path is used by the native materializer boundary stub.
- [x] Assert no app hooks, no checkpoint API, no selected-state descriptor, no source ISA emulation, no sidecar replay, and no metadata-only success in the scaffold refusal.
- [ ] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main` for the completed proof.
