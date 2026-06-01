# Proof 104 — Experimental CLI boundary consumes real-capture E2E summary

## TL;DR

Add a proof-only experimental CLI boundary for the real guest-capture E2E lane.

## Track objective

This moves CLI/productization forward without making a product claim. The command requires explicit proof-only flags and refuses product-support language.

## Translated continuation north star

The CLI boundary consumes checked evidence from the translated-continuation proof path. It does not expose a supported public restore command.

## Tasks

- [x] Add a proof-only experimental CLI harness.
- [x] Require explicit proof-only and experimental translated-continuation flags.
- [x] Consume the Proof 100 checked summary.
- [x] Refuse product-support claims and missing summaries.
- [x] Document the proof-only boundary.

## Proof result

`pnpm exec tsx proofs/104/smoke.ts` proves the CLI boundary accepts Proof 100 evidence only under explicit proof flags and refuses unsafe/product-claim variants.

## Validation

- [x] Run `pnpm exec tsx proofs/104/smoke.ts`.
- [x] Assert proof-only flags are required.
- [x] Assert product-support claim attempts refuse.
