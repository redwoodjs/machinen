# Proof 026 — Richer JS object state

## TL;DR

Prove that proper Node Level 5 can recover a small JS object graph, not just one number. This is **not** runtime-aware snapshot/restore, not a Node profile, and not an app export/import path. The proof must recover state from captured V8 memory and rebuild target-native state.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/026/`. The proof smoke test may be written in TypeScript, for example `proof/026/smoke.ts`, with an optional `proof/026/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/026/smoke.ts`.

## Goal

Extend the Node proof from a single counter cell to an object such as `{ total, history: [...] }`. The target must reconstruct the object state from source memory and serve the next response using that reconstructed state.

## Tasks

- Add a source app whose mutable state is an object with scalar properties and a small array.
- Capture source process state externally after two requests.
- Walk V8 heap/context/object references enough to find the state object.
- Decode object properties, array length, and array elements from captured memory.
- Add portable IR fragments for object properties and array elements.
- Refuse unknown hidden classes/maps, sparse arrays, accessors, proxies, symbols, external strings, or unsupported element kinds.
- Materialize equivalent target-native JS object state.

## Validation

- Add unit tests for object-property and array-element recovery/refusal.
- Run a smoke proof, e.g. `pnpm exec tsx proof/026/smoke.ts`.
- Assert source responses prove state changes before capture.
- Assert target response uses reconstructed `{ total, history }` state.
- Assert recovery does not scan prior JSON output as the source of truth.
- Assert all forbidden shortcuts remain false.
- Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
