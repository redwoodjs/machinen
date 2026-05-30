# Proof 028 — Cross-architecture source-state proof

## TL;DR

Run the proper Node Level 5 proof across architectures. This is **not** runtime-aware snapshot/restore, not source ISA emulation, and not a metadata-only cross-arch claim. The target must run target-native Node and reconstruct state from portable source-state IR.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/028/`. The proof smoke test may be written in TypeScript, for example `proof/028/smoke.ts`, with an optional `proof/028/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/028/smoke.ts`.

## Goal

Use the same source-state capture and IR to prove arm64 source to amd64 target, or amd64 source to arm64 target. The first target request must return `{count:3}` from reconstructed state.

## Tasks

- Capture source state on one architecture with the existing external quiesce flow.
- Normalize architecture-specific addresses, pointers, Node/V8 build identity, and Smi/tagged-value encoding into portable IR.
- Add target-native materialization on the opposite architecture.
- Refuse if V8 build identity, pointer compression mode, endian assumptions, or object layout cannot be translated safely.
- Prove no source ISA emulation is running on the target.
- Record source and target architecture evidence in checked summaries.

## Validation

- Run source capture on one architecture and target reconstruction on the other.
- Assert target-native Node process architecture differs from source architecture.
- Assert target returns `{count:3}`.
- Assert recovered counter came from raw V8 context/heap state, not JSON response strings or selected-state descriptors.
- Assert no app hooks, no checkpoint API, no source ISA emulation, no sidecar replay, and no metadata-only success.
- Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
