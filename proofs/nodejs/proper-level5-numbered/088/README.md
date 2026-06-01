# Proof 088 — Native verifier and assembler over real artifacts

## TL;DR

Run native assembly and native verification over capture-tool artifact files in one proof.

## Track objective

This targets the native verifier/assembler readiness gap. The accepted path uses capture-tool artifacts, a native assembler, and a native structured verifier before any target planning.

## Translated continuation north star

The goal is **translated continuation**. Capture artifacts are parsed, assembled, and verified as evidence for target-native reconstruction.

## Tasks

- [x] Generate capture-tool artifact files.
- [x] Feed the artifacts into the native assembler.
- [x] Feed a structured bundle into the native verifier.
- [x] Refuse missing artifacts and product-claim variants before target start.
- [x] Keep the proof-only boundary explicit.

## Proof result

`pnpm exec tsx proofs/by-id/088/smoke.ts` proves native assembly and native verification run over real artifact files and refuse invalid inputs before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/088/smoke.ts`.
- [x] Assert native assembler consumes artifact files.
- [x] Assert native verifier accepts only safe proof-only bundles.
