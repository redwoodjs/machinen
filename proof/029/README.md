# Proof 029 — Native V8/libuv materializer

## TL;DR

Replace the controlled JS target loader with a lower-level target-native materializer. This is **not** runtime-aware snapshot/restore, not a Node profile, and not app-level import/export. The target must rebuild enough V8/libuv state through native target mechanisms.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/029/`. The proof smoke test may be written in TypeScript, for example `proof/029/smoke.ts`, with an optional `proof/029/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/029/smoke.ts`.

## Goal

Move target materialization closer to real runtime internals by using V8 inspector/debugger-like hooks, Node embedder/internal V8 APIs, or a native continuation trampoline. The proof should still use captured source-state IR and target-native execution only.

## Tasks

- Define the target-native materialization API boundary.
- Choose one implementation path:
  - V8 inspector/debugger-style heap injection,
  - Node embedder/internal V8 APIs,
  - or a native V8/libuv trampoline.
- Recreate the JS counter cell/object in target-native V8 without a fixture-specific JS loader.
- Recreate or bind the target-native libuv TCP listener handle.
- Enter the target-native event loop.
- Refuse unsupported V8 layouts, unsupported object kinds, multiple isolates, workers, native addons, active requests, or unknown libuv handles.

## Validation

- Add unit tests for the materialization plan and refusal matrix.
- Run a native materializer smoke proof, e.g. `pnpm exec tsx proof/029/smoke.ts`.
- Assert source returns `{count:1}`, `{count:2}` before capture.
- Assert target-native materializer reconstructs state and first target request returns `{count:3}`.
- Assert no controlled JS loader path is used for the counter materialization.
- Assert no app hooks, no checkpoint API, no selected-state descriptor, no source ISA emulation, no sidecar replay, and no metadata-only success.
- Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
