# Proof 039 — Capture-emitted translated continuation bundle

## TL;DR

Stop hand-assembling the composed translated-continuation bundle in the proof smoke. Emit the bundle from real captured proof artifacts: source summary, process image inventory, heap graph IR, continuation descriptor, resource descriptors, and refusal policy.

## Track objective

The actual goal is to make the composed bundle provenance honest. Bundle fields should come from capture/materializer outputs, not from a proof-local object literal. This is still proof-local; it is not product support or broad Level 5 support.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/039/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/by-id/039/smoke.ts`; do not add a root `package.json` script.

## Goal

Produce the same kind of composed translated-continuation bundle as Proof 037, but derive it from captured files and generated IR artifacts. The smoke must prove that no bundle field required for success is hand-authored in the target path.

## Tasks

- [x] Define the input artifact set: source `summary.json`, process image inventory, heap graph IR, continuation descriptor, resource descriptors, and refusal policy.
- [x] Add a proof-local bundle emitter that reads those artifacts and writes `translated-continuation-bundle.json`.
- [x] Track per-section provenance so every accepted bundle field points to a source artifact.
- [x] Fail if a required bundle field is missing provenance.
- [x] Keep refusal policy attached and proof-only.
- [x] Prove the emitted bundle materializes target-native state and returns the next response.
- [x] Assert no app hook, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, metadata-only success, raw CPU copy, or source fd reuse.

## Proof result

`pnpm exec tsx proofs/by-id/039/smoke.ts` now proves:

- the translated-continuation bundle is emitted from artifact files under the proof work directory;
- every success-critical section has provenance;
- the emitted bundle materializes target-native state and returns `{ "count": 3, "graphTotal": 3 }`;
- missing heap graph provenance refuses before materialization;
- `proofs/by-id/039/checked-summary.json` records the accepted row, refusal row, artifact set, and provenance map.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/039/smoke.ts`.
- [x] Assert the bundle is emitted from files, not hand-authored in the target path.
- [x] Assert every success-critical bundle field has provenance.
- [x] Assert target returns the next state from the emitted bundle.
- [x] Assert tampered/missing provenance refuses before materialization.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
