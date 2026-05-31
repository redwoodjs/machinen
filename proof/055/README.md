# Proof 055 — Private CLI integration

## TL;DR

Make the private dry-run call the real verifier and materializer pieces.

## Track objective

Turn the proof-only CLI dry-run into an integration boundary that invokes the native verifier, provenance audit, refusal policy, and target materialization planner without becoming a public restore feature.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/055/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/055/smoke.ts`; do not add a root `package.json` script.

## Goal

Turn the proof-only CLI dry-run into an integration boundary that invokes the native verifier, provenance audit, refusal policy, and target materialization planner without becoming a public restore feature.

## Tasks

- [x] Wire the private proof-only CLI path to the native verifier instead of a local mock verifier.
- [x] Load a real translated-continuation bundle artifact and produce a deterministic dry-run plan.
- [x] Require explicit proof-only flags and labels for every invocation.
- [x] Refuse tampered bundles, missing provenance, product-claim flags, unsupported architectures, runtime-profile routes, raw CPU copy, source ISA emulation, app export/import, sidecar replay, and metadata-only success.
- [x] Keep dry-run mode from starting a target unless a later proof explicitly opts into proof-local materialization.
- [x] Assert no public docs or product claim matrix advertises broad support.

## Proof result

`pnpm exec tsx proof/055/smoke.ts` proves the private proof-only CLI dry-run invokes provenance checks and the native verifier, produces a no-target-start plan for a valid bundle, and refuses invalid bundles before target start.

## Validation

- [x] Run `pnpm exec tsx proof/055/smoke.ts`.
- [x] Assert the private CLI invokes native verification and provenance checks.
- [x] Assert valid proof bundles produce a dry-run plan without target start.
- [x] Assert invalid bundles refuse before target start with stable codes.
- [x] Assert output remains proof-only and not product support.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
