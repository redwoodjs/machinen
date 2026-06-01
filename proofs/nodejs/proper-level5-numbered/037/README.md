# Proof 037 — Integrated translated continuation bundle

## TL;DR

Compose the accepted pieces from Proofs 033–036 into one proof-local translated continuation bundle. The bundle carries heap graph IR, a cross-architecture continuation descriptor, libuv resource descriptors, and refusal policy. The target materializes only the supported state target-natively.

## Track objective

The actual goal is to prove the proof track can validate one composed restore plan without collapsing back into raw restore claims. Source heap bytes, registers, stacks, fds, and libuv handles remain evidence. The target uses an architecture-neutral bundle to create target-native V8/Node/libuv state, while unsupported states stay refused.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof live under `proofs/by-id/037/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/by-id/037/smoke.ts`; do not add a root `package.json` script.

## Goal

Prove a composed translated-continuation bundle for the narrow safe Node event-loop wait case. The bundle must keep heap graph reconstruction, continuation landing, and libuv resource materialization separate, then materialize target-native state that returns the next response. Refusal policy must remain attached and proof-only.

## Tasks

- [x] Define one composed bundle containing supported heap graph IR, continuation descriptor, resource descriptors, and refusal taxonomy.
- [x] Assert source and target architectures differ and raw source CPU state is not copied.
- [x] Materialize target-native object graph state with shared-reference identity.
- [x] Materialize target-native listener and repeating timer resources.
- [x] Assert the first target request returns the next state.
- [x] Assert refusal policy from the gauntlet remains attached and prevents unsupported states from becoming accepted rows.
- [x] Emit a checked summary that stays proof-only and claims no product support.

## Proof result

`pnpm exec tsx proofs/by-id/037/smoke.ts` now proves:

- the composed bundle contains heap graph, continuation, and resource sections;
- source architecture is arm64 and target architecture is amd64;
- the continuation class is `node-libuv-event-loop-wait-v1`;
- source PC/register/stack bytes, source kernel fds, and source libuv handles are not copied into the target;
- the target creates fresh target-native objects, listener, and timer state;
- the first target request returns `{ "count": 3, "graphTotal": 3 }`;
- shared-reference identity is preserved in the target heap graph;
- refusal taxonomy remains proof-only and no row claims product support or broad Level 5 implementation.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/037/smoke.ts`.
- [x] Assert composed bundle sections are present.
- [x] Assert target returns the next response from target-native materialized state.
- [x] Assert refusal taxonomy remains attached and proof-only.
- [x] Assert no app hooks, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, metadata-only success, source fd reuse, or raw CPU copy.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
