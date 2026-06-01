# Proof 035 — Native libuv resource materialization

## TL;DR

Recreate target-native libuv resources from captured source-state IR. The first scope is one TCP listener and one timer. Active streams, partially written responses, unknown handles, and ambiguous resource state must refuse.

## Track objective

The actual goal is target-native resource recreation from portable resource descriptors. Source kernel fds and libuv handles are evidence; they are not directly restored into the target. Only understood listener/timer state may be recreated, and active or ambiguous resource state must refuse.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/035/`. The proof smoke test may be written in TypeScript, for example `proofs/by-id/035/smoke.ts`, with an optional `proofs/by-id/035/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/by-id/035/smoke.ts`.

## Goal

Move resource reconstruction below the fixture JS loader. The proof should materialize target-native libuv listener/timer handles from portable resource descriptors, then bind them to the reconstructed target-native Node/V8 state.

## Tasks

- [x] Define resource descriptors for one TCP listener and one repeating timer.
- [x] Capture source fd/socket/timer/libuv evidence with the Zig guest capture tool.
- [x] Materialize a target-native TCP listener without replaying prior source responses.
- [x] Materialize a target-native repeating timer with a modeled target-native tick offset.
- [x] Bind materialized resources to target-native V8/Node callback state.
- [x] Refuse active request and partial socket/unread-byte fixtures; unknown handle types and ambiguous handles stay fail-closed in the descriptor policy.
- [x] Emit proof evidence separating recreated target resources from copied source kernel state.

## Proof result

`pnpm exec tsx proofs/by-id/035/smoke.ts` now proves:

- the source fixture has one TCP listener and one repeating timer before capture;
- the source-state IR contains resource descriptors for `tcp-listener-v1` and `repeating-timer-v1`;
- a proof-local native Zig materializer consumes those descriptors and raw memory evidence, then generates the target entrypoint;
- the target creates fresh target-native Node/libuv listener and timer handles instead of reusing source kernel fds or libuv handles;
- the first target request returns `{ "count": 3 }` from recovered raw V8 context Smi state;
- the target repeating timer continues after materialization;
- active request and partial socket/unread-byte states refuse with stable codes;
- source ISA emulation, sidecar replay, app export/import, selected-state descriptors, and metadata-only success are not used.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/035/smoke.ts`.
- [x] Assert source has one listener and one timer before capture.
- [x] Assert target has target-native listener and timer handles.
- [x] Assert first target request returns `{count:3}` and timer continues.
- [x] Assert active request and partial socket states refuse.
- [x] Assert no source kernel fd is reused directly on target, no source ISA emulation, no sidecar replay, and no metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
