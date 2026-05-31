# Proof 087 — Real end-to-end arm64 to amd64 pipeline

## TL;DR

Run captured-byte decode, native verification, and amd64 target-native Node start in one proof flow.

## Track objective

This targets the end-to-end readiness gap. The proof still uses proof-local artifacts, but it exercises the whole gated path before starting an amd64 target.

## Translated continuation north star

The goal is **translated continuation**: decode source evidence, verify a neutral bundle, then reconstruct target-native state without source-ISA emulation.

## Tasks

- [x] Decode V8 state from captured bytes with the native decoder.
- [x] Verify the translated bundle with the structured native verifier.
- [x] Start an amd64 target-native Node process only after verification.
- [x] Assert the target returns `{ count: 3, graphTotal: 3 }`.
- [x] Keep product support and broad Level 5 claims out of scope.

## Proof result

`pnpm exec tsx proof/087/smoke.ts` proves the proof-local arm64-evidence to amd64-target pipeline starts target-native Node after native verification and returns the next state.

## Validation

- [x] Run `pnpm exec tsx proof/087/smoke.ts`.
- [x] Assert native decode and native verification happen before target start.
- [x] Assert amd64 target-native Node returns next state.
