# Proof 064 — Target materializer boundary hardening

## TL;DR

Prove target materialization starts only after verifier, provenance, classifier, resource, claim, and shortcut gates pass.

## Track objective

The materializer boundary should be fail-closed. Missing or failed gates must stop before any target start.

## Translated continuation north star

Translated continuation requires verified source evidence and safe descriptors before target-native reconstruction begins.

## Tasks

- [x] Define required materializer gates.
- [x] Start target only after every gate passes.
- [x] Refuse each missing gate before target start.
- [x] Preserve the accepted next-state target response.
- [x] Keep proof-only status explicit.

## Proof result

`pnpm exec tsx proofs/064/smoke.ts` proves every missing gate refuses before target start, while the all-gates-passed row starts target-native materialization and returns `{ count: 3, graphTotal: 3 }`.

## Validation

- [x] Run `pnpm exec tsx proofs/064/smoke.ts`.
- [x] Assert target starts only after all gates pass.
- [x] Assert each missing gate refuses before target start.
