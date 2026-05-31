# Proof 053 — Bundle provenance audit

## TL;DR

Track exactly which captured artifact produced every bundle field.

## Track objective

Make provenance first-class. Every bundle field should be traceable to capture evidence, verifier output, or generated target plan, and unexplained fields should refuse.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/053/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/053/smoke.ts`; do not add a root `package.json` script.

## Goal

Make provenance first-class. Every bundle field should be traceable to capture evidence, verifier output, or generated target plan, and unexplained fields should refuse.

## Tasks

- [x] Define a provenance record for every bundle section and important field.
- [x] Record source artifact path, digest, generator, timestamp, architecture, and evidence class.
- [x] Verify provenance coverage before bundle verification succeeds.
- [x] Refuse missing, duplicate, stale, cross-section-inconsistent, or hand-edited provenance.
- [x] Emit a checked provenance summary for later proofs.
- [x] Keep provenance auditing separate from product support claims.

## Proof result

`pnpm exec tsx proof/053/smoke.ts` proves every important bundle field has provenance and that missing, duplicate, stale, hand-edited, or inconsistent provenance refuses before materialization.

## Validation

- [x] Run `pnpm exec tsx proof/053/smoke.ts`.
- [x] Assert every bundle section and important field has provenance.
- [x] Assert missing/duplicate/stale/inconsistent provenance refuses before materialization.
- [x] Assert valid provenance produces a deterministic checked summary.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
