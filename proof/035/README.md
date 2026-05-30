# Proof 035 — Native libuv resource materialization

## TL;DR

Recreate target-native libuv resources from captured source-state IR. The first scope is one TCP listener and one timer. Active streams, partially written responses, unknown handles, and ambiguous resource state must refuse.

## Track objective

The actual goal is target-native resource recreation from portable resource descriptors. Source kernel fds and libuv handles are evidence; they are not directly restored into the target. Only understood listener/timer state may be recreated, and active or ambiguous resource state must refuse.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/035/`. The proof smoke test may be written in TypeScript, for example `proof/035/smoke.ts`, with an optional `proof/035/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/035/smoke.ts`.

## Goal

Move resource reconstruction below the fixture JS loader. The proof should materialize target-native libuv listener/timer handles from portable resource descriptors, then bind them to the reconstructed target-native Node/V8 state.

## Tasks

- [ ] Define resource descriptors for one TCP listener and one repeating timer.
- [ ] Capture source fd/socket/timer/libuv evidence with the Zig guest capture tool.
- [ ] Materialize a target-native TCP listener without replaying prior source responses.
- [ ] Materialize a target-native repeating timer with recovered tick state or a modeled offset.
- [ ] Bind materialized resources to target-native V8/Node callback state.
- [ ] Refuse accepted sockets with unread bytes, pending writes, active callbacks, unknown handle types, and multiple ambiguous handles.
- [ ] Emit proof evidence separating recreated target resources from copied source kernel state.

## Validation

- [ ] Run `pnpm exec tsx proof/035/smoke.ts`.
- [ ] Assert source has one listener and one timer before capture.
- [ ] Assert target has target-native listener and timer handles.
- [ ] Assert first target request returns `{count:3}` and timer continues.
- [ ] Assert active request and partial socket states refuse.
- [ ] Assert no source kernel fd is reused directly on target, no source ISA emulation, no sidecar replay, and no metadata-only success.
- [ ] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
