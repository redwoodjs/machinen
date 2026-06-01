# Proof 025 — Timer state with one HTTP listener

## TL;DR

Prove that proper Node Level 5 can carry one simple timer along with the HTTP counter. This is **not** runtime-aware snapshot/restore, not a Node profile, and not an app checkpoint. The proof must use captured source process/runtime/native state and target-native reconstruction.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/025/`. Proof smoke tests may be written in TypeScript. This proof is implemented at `proofs/by-id/025/smoke.ts`; `proofs/by-id/025/smoke.sh` is only a compatibility wrapper. Do not add root `package.json` scripts for this proof; run it directly with `pnpm exec tsx proofs/by-id/025/smoke.ts`.

## Status

Implemented by `proofs/by-id/025/smoke.ts` and run directly with `pnpm exec tsx proofs/by-id/025/smoke.ts`. The source app, Zig guest capture tool, and target loader live beside it as proof-local fixture files.

## Goal

Extend the current Node HTTP counter proof so the source also has one `setInterval` or equivalent libuv timer. After external capture, the target-native Node process reconstructs the counter and timer state and shows the timer continues with equivalent behavior.

## Tasks

- [x] Add a source app with one HTTP listener and one simple timer.
- [x] Externally quiesce the source process between requests.
- [x] Capture `/proc` state, accepted memory mappings, fd table, socket state, and timer/libuv evidence.
- [x] Recover V8 counter state from closure/context memory, not response strings.
- [x] Find the libuv timer handle or enough native state to describe it in the portable IR.
- [x] Refuse if timer evidence is missing, active timer callback execution is detected, workers/native addons are present, or timer shape is unknown. Multiple-timer ambiguity is covered by the libuv timer recovery helper.
- [x] Materialize target-native Node with equivalent counter and timer behavior.

## Proof result

`pnpm exec tsx proofs/by-id/025/smoke.ts` now proves:

- source Node returns `{ "count": 1 }`, `{ "count": 2 }`;
- source timer state is observed before capture;
- capture is external (`SIGSTOP`) using `proofs/by-id/025/guest-capture.zig` and records `/proc`, memory, fd/socket, V8, and timer evidence;
- target-native Node reconstructs count from a raw V8 context Smi slot;
- target-native Node reconstructs timer ticks from raw captured timer context state;
- target returns `{ "count": 3 }` and its reconstructed timer keeps ticking.

## Validation

- [x] Run the focused unit tests for V8/libuv recovery helpers.
- [x] Run `pnpm exec tsx proofs/by-id/025/smoke.ts`.
- [x] Assert source returns `{count:1}`, `{count:2}` before capture.
- [x] Assert target returns `{count:3}` after reconstruction.
- [x] Assert timer evidence is recovered from captured source state.
- [x] Assert no app hooks, no checkpoint API, no selected-state descriptor, no source ISA emulation, no sidecar replay, and no metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
