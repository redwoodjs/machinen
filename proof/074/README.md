# Proof 074 — Live procfs multi-thread capture

## TL;DR

Capture all procfs-shaped thread entries for a live proof process and classify the whole process.

## Track objective

Keep moving the translated-continuation ladder from proof-local fixtures toward captured evidence, native verification, and target-native reconstruction, while staying proof-only.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof live under `proof/074/`. Run with `pnpm exec tsx proof/074/smoke.ts`; do not add a root `package.json` script.

## Tasks

- [x] Add a proof-local smoke for this ladder step.
- [x] Prove the accepted path remains translated-continuation proof-only evidence.
- [x] Prove unsafe or incomplete neighboring states refuse before target start.
- [x] Emit a deterministic checked summary.
- [x] Avoid product support, raw CPU restore, source ISA emulation, sidecar replay, and metadata-only success claims.

## Proof result

`pnpm exec tsx proof/074/smoke.ts` proves: capture all procfs-shaped thread entries for a live proof process and classify the whole process.

## Validation

- [x] Run `pnpm exec tsx proof/074/smoke.ts`.
- [x] Assert accepted proof-only path succeeds.
- [x] Assert refusal rows stop before target start.
