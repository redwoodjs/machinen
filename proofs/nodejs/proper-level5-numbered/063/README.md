# Proof 063 — Provenance chain signing and digest lock

## TL;DR

Make provenance tamper-evident across capture, bundle, verifier, and private CLI stages.

## Track objective

Every stage should carry a digest link to the previous stage and a proof-local signature. Tampering or broken links must refuse before target start.

## Translated continuation north star

Translated continuation needs trustworthy evidence flow. Provenance protects the translation path; it does not create product support by itself.

## Tasks

- [x] Create a capture → bundle → verifier → CLI provenance chain.
- [x] Add digest links between every stage.
- [x] Add proof-local signatures for every stage.
- [x] Refuse tampered signatures and broken links before target start.
- [x] Keep the chain proof-only.

## Proof result

`pnpm exec tsx proofs/by-id/063/smoke.ts` proves the provenance chain verifies and tampered or broken-link variants refuse.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/063/smoke.ts`.
- [x] Assert every chain stage is locked to the previous stage.
- [x] Assert tampering refuses before target start.
