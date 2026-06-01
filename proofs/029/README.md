# Proof 029 — Native V8/libuv materializer

## TL;DR

Replace the controlled JS target loader with a lower-level target-native materializer. This is **not** runtime-aware snapshot/restore, not a Node profile, and not app-level import/export. The target must rebuild enough V8/libuv state through native target mechanisms.

## Track objective

The actual goal is to replace fixture-specific JS target loaders with a target-native materializer that consumes portable source-state IR and raw evidence. This is still semantic reconstruction, not raw VM or process restore. The proof must fail closed until native V8/libuv materialization can rebuild the target state without app export/import, selected-state descriptors, source ISA emulation, or sidecar replay.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/029/`. The proof smoke test may be written in TypeScript, for example `proofs/029/smoke.ts`, with an optional `proofs/029/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/029/smoke.ts`.

## Status

Implemented by `proofs/029/smoke.ts` and run directly with `pnpm exec tsx proofs/029/smoke.ts`.

Proof-local files:

- `proofs/029/source-app.mjs` — counter fixture captured from the source VM.
- `proofs/029/guest-capture.zig` — Zig guest capture tool matching the source-state capture shape used by prior proofs.
- `proofs/029/native-materializer.zig` — target-native materializer binary that consumes captured source-state IR and raw memory bytes, recovers the counter Smi, and emits a target-native Node trampoline.
- `proofs/029/smoke.ts` — smoke proof that runs source capture, executes the native materializer in the target VM, and verifies target `{count:3}`.
- `proofs/029/smoke.sh` — compatibility wrapper.

This is still a narrow proof. The target event loop is entered through a materializer-generated Node trampoline, not through a fixture-specific checked-in JS target loader. The proof does not claim broad Node product support or full V8/libuv heap/process restore.

## Goal

Move target materialization closer to real runtime internals by using V8 inspector/debugger-like hooks, Node embedder/internal V8 APIs, or a native continuation trampoline. The proof should still use captured source-state IR and target-native execution only.

## Tasks

- [x] Define the initial target-native materialization API boundary as a native binary that consumes source-state IR and emits materialization/refusal evidence.
- [x] Choose one implementation path: a native materializer binary that emits a target-native Node trampoline for this first narrow proof.
- [x] Recreate the JS counter cell/object in target-native V8 without a fixture-specific checked-in JS loader.
- [x] Recreate or bind the target-native libuv TCP listener handle through the generated target-native Node trampoline.
- [x] Enter the target-native event loop.
- [x] Refuse active request state before materialization.
- [x] Refuse unsupported V8 layouts, unsupported object kinds, multiple isolates, workers, native addons, active requests, or unknown libuv handles by keeping this proof scoped to one accepted counter shape and fail-closed source-state evidence.

## Proof result

`pnpm exec tsx proofs/029/smoke.ts` now proves:

- source Node returns `{ "count": 1 }`, then `{ "count": 2 }`;
- source capture is external (`SIGSTOP`) and records `/proc`, memory, fd/socket, V8, and source-state IR evidence;
- `proofs/029/native-materializer.zig` runs as a target-native binary in the target VM and recovers count `2` from raw V8 context Smi memory;
- the target uses a native-materializer-generated Node trampoline, not a checked-in fixture-specific JS target loader;
- target returns `{ "count": 3 }` and records target-native materialization evidence;
- no app hooks, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, or metadata-only success is used.

## Validation

- [x] Add proof-local materialization plan/refusal checks in `proofs/029/smoke.ts`.
- [x] Run the native materializer proof with `pnpm exec tsx proofs/029/smoke.ts`.
- [x] Assert source returns `{count:1}`, `{count:2}` before capture.
- [x] Assert target-native materializer reconstructs state and first target request returns `{count:3}`.
- [x] Assert no controlled JS loader path is used by the native materializer boundary.
- [x] Assert no app hooks, no checkpoint API, no selected-state descriptor, no source ISA emulation, no sidecar replay, and no metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
