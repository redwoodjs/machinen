# Proof 046 — Private CLI translated bundle dry-run

## TL;DR

Carry the translated-continuation bundle through a private proof-only CLI path. The CLI should verify the bundle and run a dry-run target materialization without advertising product support.

## Track objective

The actual goal is to prove the artifact can pass through the real command boundary while staying proof-only. The CLI path should be private/non-public, clearly labeled, and refusal-first. This is not a public restore feature.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/046/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/046/smoke.ts`; do not add a root `package.json` script.

## Goal

Wire a proof-only dry-run command path that reads a translated-continuation bundle, invokes verification, and reports accepted/refused results. Accepted dry-runs may materialize a proof-local target; refused bundles must stop before materialization.

## Tasks

- [x] Add a private proof-only CLI wrapper for bundle verification/materialization dry-run.
- [x] Require explicit proof-only dry-run flags and labels.
- [x] Verify valid bundles and refuse tampered bundles before target start.
- [x] Carry checked-summary output through the CLI path.
- [x] Assert the command does not appear in public support docs as product support through the Proof 045 claim policy.
- [x] Assert the path refuses runtime-profile, raw CPU restore, source ISA emulation, app export/import, sidecar replay, and metadata-only success.
- [x] Keep proof-local smokes under `proofs/046/` with no root package script.

## Proof result

`pnpm exec tsx proofs/046/smoke.ts` now proves:

- a private proof-only CLI command accepts a valid translated-continuation bundle only with `--dry-run`;
- the dry run verifies section integrity and produces a target materialization plan without starting a target;
- wrong command, missing dry-run flag, and tampered bundle variants refuse before target start;
- output remains proof-only and does not claim public/product support.

## Validation

- [x] Run `pnpm exec tsx proofs/046/smoke.ts`.
- [x] Assert the private CLI dry-run accepts a valid proof bundle.
- [x] Assert tampered bundles refuse before target start.
- [x] Assert output is proof-only and not product support.
- [x] Assert no public docs or product claim matrix row advertises broad support.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
