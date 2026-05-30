# Proof 085 — Product-boundary and docs audit for 066–084

## TL;DR

Re-audit the stronger Proofs 066–084 so they still do not claim public product support.

## Track objective

The proof ladder now has stronger capture, native, live-evidence, and CLI harnesses. This audit keeps those harnesses clearly proof-only and checks public docs for accidental broad support claims.

## Translated continuation north star

The goal remains **translated continuation**, not raw cross-architecture CPU restore. These proofs are harness evidence, not public product support.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof live under `proof/085/`. Run with `pnpm exec tsx proof/085/smoke.ts`; do not add a root `package.json` script.

## Tasks

- [x] Audit Proofs 066–084 for product support flags.
- [x] Audit broad Level 5 claim flags.
- [x] Check public docs for forbidden product-support claims.
- [x] Keep raw cross-architecture CPU restore explicitly unclaimed.
- [x] Emit a deterministic checked summary.

## Proof result

`pnpm exec tsx proof/085/smoke.ts` proves Proofs 066–084 and public docs keep proof-only boundaries and do not advertise broad translated-continuation product support.

## Validation

- [x] Run `pnpm exec tsx proof/085/smoke.ts`.
- [x] Assert no audited proof claims product support or broad Level 5 support.
- [x] Assert public docs do not advertise broad translated-continuation support.
