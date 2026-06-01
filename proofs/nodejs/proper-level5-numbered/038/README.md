# Proof 038 — Translated bundle integrity refusal

## TL;DR

Add integrity checks around the composed translated-continuation bundle. A target must refuse if any required bundle section is missing, tampered, replayed against the wrong architecture, or tries to smuggle raw source CPU/kernel state into the target.

## Track objective

The actual goal is to protect the composed bundle from false success. A bundle is accepted only when its hashes, architecture plan, heap graph IR, continuation descriptor, resource descriptors, refusal policy, and shortcut gates agree. Invalid bundles refuse before target materialization.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof live under `proofs/by-id/038/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/by-id/038/smoke.ts`; do not add a root `package.json` script.

## Goal

Prove that the translated-continuation bundle is accepted only when all sections are internally consistent and proof-only. Tampered or shortcut-bearing bundles must refuse before target materialization. The valid bundle must still materialize target-native state and return the next response.

## Tasks

- [x] Define a canonical bundle digest over heap graph, continuation, resource, and refusal-policy sections.
- [x] Accept the valid bundle and materialize target-native state.
- [x] Refuse missing heap graph IR.
- [x] Refuse architecture mismatch between bundle and descriptor.
- [x] Refuse raw source register/PC/stack copy flags.
- [x] Refuse source kernel fd or libuv handle reuse.
- [x] Refuse stale/tampered section digests.
- [x] Refuse product-support or broad Level 5 claims in proof-local bundles.

## Proof result

`pnpm exec tsx proofs/by-id/038/smoke.ts` now proves:

- the valid translated-continuation bundle passes integrity checks and returns `{ "count": 3, "graphTotal": 3 }`;
- eight tampered bundle variants refuse before target materialization;
- refusal codes are stable and included in the checked summary;
- source CPU state and source kernel/libuv state remain evidence only;
- no app hook, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, metadata-only success, product support claim, or broad Level 5 claim is accepted.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/038/smoke.ts`.
- [x] Assert valid bundle materializes target-native state.
- [x] Assert each tampered bundle refuses with its expected stable code.
- [x] Assert refused bundles never start target materialization.
- [x] Assert checked summary remains proof-only and not product support.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
