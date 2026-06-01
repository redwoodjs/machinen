# Proof 089 — Repeatability and negative gauntlet lane

## TL;DR

Run the accepted proof shape repeatedly and prove the negative cases stay deterministic and refuse before target start.

## Track objective

This targets repeatability and CI-readiness confidence without changing CI workflows. It records the proof-local commands a future proof lane would run and proves stable checked output across repeated runs.

## Translated continuation north star

The goal is **translated continuation**. Repeatability matters because capture, verification, and target-native materialization must be stable before any product claim.

## Tasks

- [x] Run the accepted proof shape multiple times.
- [x] Normalize run-specific fields and require a stable digest.
- [x] Include a negative gauntlet for missing bytes, tampered bundle, unsafe thread, source ISA emulation, product claim, and unread resource bytes.
- [x] Prove negative cases never start the target.
- [x] Document a proof-local CI lane without changing workflow files.

## Proof result

`pnpm exec tsx proofs/089/smoke.ts` proves five normalized runs produce one stable digest and six negative cases refuse before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/089/smoke.ts`.
- [x] Assert repeatability digest is stable.
- [x] Assert negative cases refuse before target start.
