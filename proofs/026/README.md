# Proof 026 — Richer JS object state

## TL;DR

Prove that proper Node Level 5 can recover a small JS object graph, not just one number. This is **not** runtime-aware snapshot/restore, not a Node profile, and not an app export/import path. The proof must recover state from captured V8 memory and rebuild target-native state.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/026/`. The proof smoke test may be written in TypeScript, for example `proofs/026/smoke.ts`, with an optional `proofs/026/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/026/smoke.ts`.

## Status

Implemented by `proofs/026/smoke.ts` and run directly with `pnpm exec tsx proofs/026/smoke.ts`. The source app, Zig guest capture tool, and target loader live beside it as proof-local fixture files.

## Goal

Extend the Node proof from a single counter cell to an object such as `{ total, history: [...] }`. The target must reconstruct the object state from source memory and serve the next response using that reconstructed state.

## Tasks

- [x] Add a source app whose mutable state is an object with scalar properties and a small array.
- [x] Capture source process state externally after two requests.
- [x] Walk V8 heap/context/object references enough to find the state object.
- [x] Decode object properties, array length, and array elements from captured memory.
- [x] Add portable IR fragments for object properties and array elements.
- [x] Refuse unknown hidden classes/maps, sparse arrays, accessors, proxies, symbols, external strings, or unsupported element kinds.
- [x] Materialize equivalent target-native JS object state.

## Proof result

`pnpm exec tsx proofs/026/smoke.ts` now proves:

- source Node returns `{ "total": 1, "history": [1] }`, then `{ "total": 2, "history": [1, 2] }`;
- capture is external (`SIGSTOP`) using `proofs/026/guest-capture.zig` and records `/proc`, memory, fd/socket, V8, and object-state evidence;
- target-native Node reconstructs `total` and `history` from raw V8 object/context Smi slots near the retained object-state anchor;
- target returns `{ "total": 3, "history": [1, 2, 3] }` from reconstructed state;
- prior JSON response strings are recorded only as shortcut-refusal evidence, not as the recovery source of truth.

## Validation

- [x] Add unit tests for object-property and array-element recovery/refusal.
- [x] Run `pnpm exec tsx proofs/026/smoke.ts`.
- [x] Assert source responses prove state changes before capture.
- [x] Assert target response uses reconstructed `{ total, history }` state.
- [x] Assert recovery does not scan prior JSON output as the source of truth.
- [x] Assert all forbidden shortcuts remain false.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
