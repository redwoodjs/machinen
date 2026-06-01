# Proof 028 — Cross-architecture source-state proof

## TL;DR

Run the proper Node Level 5 proof across architectures. This is **not** runtime-aware snapshot/restore, not source ISA emulation, and not a metadata-only cross-arch claim. The target must run target-native Node and reconstruct state from portable source-state IR.

## Track objective

The object being captured/restored in this proof track is a **portable source-state IR plus raw evidence**, not a full VM snapshot or raw process image. The success condition is target-native semantic reconstruction: recover the source Node counter from captured V8 memory evidence and make an opposite-architecture target return the next value. CPU registers, the full V8 heap, and the complete source process image remain outside the claim unless a later proof explicitly implements them.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/028/`. The proof smoke test may be written in TypeScript, for example `proofs/by-id/028/smoke.ts`, with an optional `proofs/by-id/028/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/by-id/028/smoke.ts`.

## Status

Implemented by `proofs/by-id/028/smoke.ts` and run directly with `pnpm exec tsx proofs/by-id/028/smoke.ts`. The proof captures an arm64 source VM, then runs an amd64 target-ISA Node process in a `linux/amd64` container for target-native reconstruction. The target does not emulate or execute source arm64 code; it reads the portable source-state IR and captured memory bytes.

Proof-local files:

- `proofs/by-id/028/source-app.mjs` — cross-arch HTTP counter fixture.
- `proofs/by-id/028/guest-capture.zig` — Zig guest capture tool for source `/proc`, fd/socket, and memory evidence.
- `proofs/by-id/028/target-loader.mjs` — target Node materializer that refuses same-arch runs and reconstructs count from raw captured V8 state.
- `proofs/by-id/028/smoke.ts` — host orchestrator for arm64 source capture and amd64 target reconstruction.
- `proofs/by-id/028/smoke.sh` — compatibility wrapper.

## Goal

Use the same source-state capture and IR to prove arm64 source to amd64 target, or amd64 source to arm64 target. The first target request must return `{count:3}` from reconstructed state.

## Tasks

- [x] Capture source state on one architecture with the existing external quiesce flow.
- [x] Normalize architecture-specific addresses, pointers, Node/V8 build identity, and Smi/tagged-value encoding into portable IR.
- [x] Add target-native materialization on the opposite architecture.
- [x] Refuse if source and target architectures match, source Node/V8 build identity is missing, endian assumptions are unsupported, or pointer/Smi encoding cannot be decoded.
- [x] Prove no source ISA emulation is running on the target.
- [x] Record source and target architecture evidence in the proof summary and target proof result.

## Proof result

`pnpm exec tsx proofs/by-id/028/smoke.ts` now proves:

- source runs as `arm64`/`aarch64` in a Machinen guest and returns `{ "count": 1 }`, then `{ "count": 2 }`;
- source capture is external (`SIGSTOP`) and records source architecture, `/proc`, memory, fd/socket, and V8 evidence with `proofs/by-id/028/guest-capture.zig`;
- the portable IR records source `arm64`, target `amd64`, source Node/V8 build identity, little-endian Smi/tagged-value assumptions, memory fragments, and listener descriptors;
- target runs Node as `amd64` (`process.arch === "x64"`) in a `linux/amd64` target container and returns `{ "count": 3 }`;
- the recovered count came from raw V8 context Smi state near `machinen-level5-v8-context-anchor-v1`, not response-string replay or a selected-state descriptor;
- no app hook, checkpoint API, source ISA emulation, sidecar replay, or metadata-only success is used.

## Validation

- [x] Run source capture on one architecture and target reconstruction on the other.
- [x] Assert target-native Node process architecture differs from source architecture.
- [x] Assert target returns `{count:3}`.
- [x] Assert recovered counter came from raw V8 context/heap state, not JSON response strings or selected-state descriptors.
- [x] Assert no app hooks, no checkpoint API, no source ISA emulation, no sidecar replay, and no metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
