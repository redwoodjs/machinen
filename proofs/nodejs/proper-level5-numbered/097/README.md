# Proof 097 — Native parser validates guest-capture record schema

## TL;DR

Parse the Zig guest-capture records with a native verifier before any decode or target step.

## Track objective

This replaces more harness trust with native validation. The parser checks required records, schema kind, capture tool identity, and hand-authored flags.

## Translated continuation north star

Guest records are evidence. Native parsing decides whether the evidence is trustworthy enough to feed later translation steps.

## Tasks

- [x] Add a native guest record parser.
- [x] Parse all required JSON capture records from Proof 096.
- [x] Refuse missing records, bad schema kind, and bad capture tool identity.
- [x] Stop before target start on every refusal.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proofs/by-id/097/smoke.ts` proves the native parser accepts valid Zig capture records and refuses malformed records before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/097/smoke.ts`.
- [x] Assert native parser validates guest record schema.
- [x] Assert invalid records refuse before target start.
