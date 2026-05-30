# Proof 040 — Native translated bundle verifier

## TL;DR

Move translated bundle integrity checks from TypeScript into a native Zig verifier/materializer boundary. Invalid bundles must refuse before Node starts.

## Track objective

The actual goal is to make the bundle acceptance boundary target-native and stricter. The verifier should consume the emitted bundle, check digests/provenance/policy, and either write refusal evidence or allow target-native materialization. This is still proof-local and not product support.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/040/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/040/smoke.ts`; do not add a root `package.json` script.

## Goal

Prove a native verifier that accepts only an intact translated-continuation bundle and refuses tampered bundles before target Node is launched.

## Tasks

- [x] Implement `proof/040/native-bundle-verifier.zig`.
- [x] Verify required bundle sections natively before target launch.
- [x] Verify source/target architecture plan and continuation descriptor consistency.
- [x] Verify raw source CPU state and source kernel/libuv handles are not copied into the target.
- [x] Verify refusal policy is attached and proof-only.
- [x] Emit target entrypoint only after native verification succeeds.
- [x] Emit stable refusal JSON for invalid bundles.

## Proof result

`pnpm exec tsx proof/040/smoke.ts` now proves:

- a native Zig verifier accepts the valid translated-continuation bundle;
- target Node is launched only after native verifier success;
- the target returns `{ "count": 3, "graphTotal": 3 }`;
- missing heap graph, architecture mismatch, raw CPU copy, source fd reuse, product claims, and forbidden shortcuts refuse with stable JSON before Node starts;
- verifier output is the only authority for target launch.

## Validation

- [x] Run `pnpm exec tsx proof/040/smoke.ts`.
- [x] Assert valid bundle passes native verification and target returns the next state.
- [x] Assert missing sections, forbidden shortcuts, product claims, source fd reuse, raw CPU copy, and architecture mismatches refuse before Node starts.
- [x] Assert verifier output is the only authority for target launch.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
