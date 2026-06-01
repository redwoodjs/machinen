# Proof 059 — Real cross-arch end-to-end smoke

## TL;DR

Run capture artifacts, native assembly, native verification, and amd64 target planning in one proof flow.

## Track objective

The proof should connect the pieces from Proofs 056–058 and keep the cross-architecture boundary explicit: arm64 source evidence becomes an amd64 target-native plan without source-ISA emulation.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation.

## Tasks

- [x] Invoke the capture artifact tool.
- [x] Invoke the native bundle assembler.
- [x] Invoke the structured native verifier.
- [x] Prove arm64 source to amd64 target-native next state.
- [x] Refuse bad architecture and source-ISA-emulation variants before target start.

## Proof result

`pnpm exec tsx proofs/by-id/059/smoke.ts` proves the proof-local end-to-end flow reaches `{ count: 3, graphTotal: 3 }` and refuses unsafe cross-arch variants before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/059/smoke.ts`.
- [x] Assert capture, assembly, and native verification run before materialization.
- [x] Assert no source ISA emulation or raw CPU copy is used.
