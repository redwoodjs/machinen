# Proof 090 — CLI, docs, and support matrix candidate

## TL;DR

Define the narrow candidate support subset while proving it is still not product support.

## Track objective

This targets the CLI/docs/support-matrix readiness gap. It creates a proof-local support matrix for the candidate subset and audits proofs/docs so the stronger evidence does not become an accidental product claim.

## Translated continuation north star

The goal remains **translated continuation**. The matrix describes a candidate path only; it does not claim raw cross-architecture CPU restore or public product support.

## Tasks

- [x] Define the candidate Node subset in a proof-local support matrix.
- [x] Mark the subset as candidate-not-supported.
- [x] Assert no public CLI support is added.
- [x] Assert any private CLI path requires a proof-only flag.
- [x] Audit proof docs and public docs for overclaims.

## Proof result

`pnpm exec tsx proofs/090/smoke.ts` proves the candidate subset is documented as not supported, no public CLI support is added, and docs do not advertise translated-continuation product support.

## Validation

- [x] Run `pnpm exec tsx proofs/090/smoke.ts`.
- [x] Assert support matrix status is candidate-not-supported.
- [x] Assert proof and public docs do not claim product support.
