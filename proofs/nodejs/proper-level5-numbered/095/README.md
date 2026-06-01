# Proof 095 — Experimental CLI docs and refusal errors

## TL;DR

Add a proof-only experimental CLI harness, support matrix, docs, and clear refusal messages without claiming product support.

## Track objective

This targets the fifth remaining product blocker: a public/experimental CLI shape with clear docs and refusal errors. The proof keeps the command proof-only and marks the candidate subset as not supported.

## Translated continuation north star

The CLI path is only a harness for translated continuation evidence. It does not claim public restore support or raw cross-architecture CPU restore.

## Tasks

- [x] Add a proof-only experimental CLI harness.
- [x] Require explicit experimental and proof-only flags.
- [x] Add a support matrix that says candidate-not-supported.
- [x] Add clear refusal messages for missing flags, active request state, and product-claim attempts.
- [x] Audit proof-local docs for the proof-only boundary.

## Proof result

`pnpm exec tsx proofs/by-id/095/smoke.ts` proves the experimental CLI dry-run accepts only with explicit flags, refuses unsafe cases with clear messages, and keeps the support matrix not-supported.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/095/smoke.ts`.
- [x] Assert the CLI requires explicit proof-only flags.
- [x] Assert refusal errors include clear messages.
