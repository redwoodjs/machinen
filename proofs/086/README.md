# Proof 086 — Real V8 captured-byte recovery

## TL;DR

Recover the counter and graph total from a raw captured memory-byte artifact with a native decoder.

## Track objective

This reduces the biggest product-readiness gap: V8 state recovery. It still stays proof-only, but the accepted path now reads bytes from a memory-map-shaped artifact instead of modeled JSON objects.

## Translated continuation north star

The goal is **translated continuation**. Captured V8 bytes are evidence for decoding and target-native reconstruction; they are not copied into a target V8 heap.

## Tasks

- [x] Add a raw captured-byte artifact with V8-state evidence.
- [x] Decode supported Smi values in native Zig.
- [x] Materialize the target next state from decoded values.
- [x] Refuse missing marker, truncated range, and unsupported Smi tags before target start.
- [x] Keep byte-for-byte heap restore and product support out of scope.

## Proof result

`pnpm exec tsx proofs/086/smoke.ts` proves native byte recovery returns `{ count: 3, graphTotal: 3 }` for the accepted row and refuses malformed byte artifacts before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/086/smoke.ts`.
- [x] Assert native decoder reads captured bytes.
- [x] Assert invalid byte artifacts refuse before target start.
