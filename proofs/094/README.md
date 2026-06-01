# Proof 094 — Real E2E repeatability automation

## TL;DR

Run the real arm64-to-amd64 proof flow repeatedly and record a proof-local automation lane.

## Track objective

This targets the fourth remaining product blocker: repeatability and automation confidence. It re-runs the real E2E proof and requires stable normalized results.

## Translated continuation north star

Translated continuation must be repeatable before it can become product behavior. Repeated runs must keep refusing unsafe paths before target start.

## Tasks

- [x] Run the real Proof 087 E2E path more than once.
- [x] Normalize run-specific fields and require a stable digest.
- [x] Record negative cases that stop before target start.
- [x] Document a proof-local automation lane without changing workflow files.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proofs/094/smoke.ts` proves repeated Proof 087 runs produce stable normalized results and documents the proof-local automation lane.

## Validation

- [x] Run `pnpm exec tsx proofs/094/smoke.ts`.
- [x] Assert real E2E runs repeatably.
- [x] Assert negative cases stop before target start.
