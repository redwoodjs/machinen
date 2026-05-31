# Proof 041 — Cross-architecture composed bundle materialization

## TL;DR

Combine the cross-architecture proof path with the composed translated-continuation bundle. Capture on arm64, emit a composed bundle, verify it, and materialize target-native state on amd64 without source ISA emulation.

## Track objective

The actual goal is to prove the composed bundle survives a real cross-architecture path. The target must use target-native Node/libuv/V8 reconstruction from architecture-neutral descriptors. This is not raw CPU restore and not product support.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/041/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/041/smoke.ts`; do not add a root `package.json` script.

## Goal

Run a full proof-local arm64 source to amd64 target composed-bundle path. The target should materialize heap graph state, continuation landing, listener, and timer target-natively.

## Tasks

- [x] Model source state as an arm64 captured composed bundle for this proof-local harness.
- [x] Emit a composed bundle with heap graph IR, continuation descriptor, resource descriptors, and refusal policy.
- [x] Verify source and target architectures differ.
- [x] Materialize on amd64 target-native Node.
- [x] Prove target returns the next state from reconstructed heap/resource state.
- [x] Prove no source ISA emulation, raw CPU copy, source fd reuse, sidecar replay, or metadata-only success.
- [x] Keep unsupported states refused before target materialization through attached refusal policy.

## Proof result

`pnpm exec tsx proof/041/smoke.ts` now proves:

- the composed bundle declares arm64 source and amd64 target;
- the target runs in a `linux/amd64` Node container;
- the target materializes target-native heap/resource state and returns `{ "count": 3, "graphTotal": 3 }`;
- shared-reference and listener evidence is preserved;
- source registers, PC, stack, fds, and libuv handles are evidence only;
- no source ISA emulation, raw CPU copy, source fd reuse, sidecar replay, metadata-only success, or app export/import is used.

## Validation

- [x] Run `pnpm exec tsx proof/041/smoke.ts`.
- [x] Assert source architecture is arm64 and target architecture is amd64.
- [x] Assert target-native Node is used.
- [x] Assert target returns the next composed state.
- [x] Assert source registers/PC/stack are evidence only.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
