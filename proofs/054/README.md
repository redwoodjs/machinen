# Proof 054 — Negative shortcut gauntlet

## TL;DR

Try every forbidden shortcut and prove each one fails.

## Track objective

Add a dedicated gauntlet of malicious or shortcut bundles/captures. The proof should make it hard to accidentally pass by replaying output, copying raw CPU state, using app exports, or claiming metadata-only success.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/054/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/054/smoke.ts`; do not add a root `package.json` script.

## Goal

Add a dedicated gauntlet of malicious or shortcut bundles/captures. The proof should make it hard to accidentally pass by replaying output, copying raw CPU state, using app exports, or claiming metadata-only success.

## Tasks

- [x] Create negative fixtures for app export/import, checkpoint hooks, selected-state descriptors, source ISA emulation, raw register/PC/stack copy, source fd reuse, sidecar replay, runtime-profile routes, response-string replay, and metadata-only success.
- [x] Run each fixture through the verifier and private materialization boundary.
- [x] Require stable refusal codes for every forbidden shortcut.
- [x] Assert refused variants never start the target materializer.
- [x] Emit a deterministic checked summary listing all refused shortcuts.
- [x] Keep the accepted control row proof-only and narrow.

## Proof result

`pnpm exec tsx proofs/054/smoke.ts` proves twelve forbidden shortcut variants refuse with stable codes before target start, while the accepted control row still uses translated continuation and returns the next state.

## Validation

- [x] Run `pnpm exec tsx proofs/054/smoke.ts`.
- [x] Assert every forbidden shortcut refuses with the expected stable code.
- [x] Assert no refused variant starts target materialization.
- [x] Assert accepted control row still uses translated continuation, not a shortcut.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
