# Proof 100 — Real guest capture to amd64 target E2E

## TL;DR

Run the proof flow from Zig guest capture records through native parsing, native V8 byte decoding, native verification, and amd64 target start.

## Track objective

This is the main readiness jump for the 096–100 block. The accepted path starts from Zig guest capture output instead of proof-shaped artifacts.

## Translated continuation north star

The flow is translated continuation: capture source evidence, parse and decode it, verify a neutral bundle, then start target-native Node without source-ISA emulation.

## Tasks

- [x] Emit guest capture records with the Zig tool.
- [x] Parse records with the native parser.
- [x] Decode V8 memory bytes with the native decoder.
- [x] Verify the bundle with the structured native verifier.
- [x] Start amd64 target-native Node and return the next state.

## Proof result

`pnpm exec tsx proofs/by-id/100/smoke.ts` proves Zig guest capture → native parse → native V8 decode → native verify → amd64 target response `{ count: 3, graphTotal: 3 }`.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/100/smoke.ts`.
- [x] Assert all gates run before target start.
- [x] Assert amd64 target-native Node returns next state.
