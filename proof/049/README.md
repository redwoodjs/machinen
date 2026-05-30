# Proof 049 — Real arm64 VM to amd64 composed run

## TL;DR

Run the full composed proof with actual arm64 VM source evidence and amd64 target-native materialization.

## Track objective

Compose the previous pieces into a stronger cross-architecture run: capture from an arm64 source VM, verify the emitted bundle, then materialize the equivalent continuation in amd64 target-native Node.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/049/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/049/smoke.ts`; do not add a root `package.json` script.

## Goal

Compose the previous pieces into a stronger cross-architecture run: capture from an arm64 source VM, verify the emitted bundle, then materialize the equivalent continuation in amd64 target-native Node.

## Tasks

- [x] Capture source evidence from an arm64 VM using the proof-local capture path.
- [x] Emit and verify a composed translated-continuation bundle from the captured artifacts.
- [x] Run target materialization in a `linux/amd64` Node environment.
- [x] Prove the target returns the next heap/resource state.
- [x] Prove source and target architectures differ and no source arm64 code is executed on the target.
- [x] Preserve active/unsafe-state refusals before target start.

## Proof result

`pnpm exec tsx proof/049/smoke.ts` proves a composed arm64 VM capture-evidence bundle verifies before amd64 target-native materialization, returns the next state, and refuses same-arch, missing-verifier, and source-ISA-emulation shortcuts before target start.

## Validation

- [x] Run `pnpm exec tsx proof/049/smoke.ts`.
- [x] Assert source is arm64 and target is amd64.
- [x] Assert target-native Node returns the next state.
- [x] Assert native verifier runs before materialization.
- [x] Assert no source ISA emulation, raw CPU copy, source fd reuse, sidecar replay, app export/import, or metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
