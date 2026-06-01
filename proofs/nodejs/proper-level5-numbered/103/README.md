# Proof 103 — Repeat real guest-capture E2E automation

## TL;DR

Run the Proof 100 real guest-capture E2E lane twice and compare normalized digests.

## Track objective

This turns the real-capture E2E path into a repeatability guard. It is still proof-only, but it exercises the full path twice.

## Translated continuation north star

Repeatability must cover translated continuation evidence flow: capture records, native parser, native decoder, native verifier, and target-native reconstruction.

## Tasks

- [x] Run Proof 100 twice.
- [x] Normalize volatile data away.
- [x] Compare stable digests.
- [x] Assert both runs return the amd64 target next state.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proofs/by-id/103/smoke.ts` proves the real-capture E2E lane is repeatable across two runs.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/103/smoke.ts`.
- [x] Assert normalized digests match.
- [x] Assert both target runs return `{ count: 3, graphTotal: 3 }`.
