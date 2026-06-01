# Proof 060 — V8 decoder from captured bytes

## TL;DR

Decode supported object, array, string, and Smi state from captured byte buffers instead of modeled layout objects.

## Track objective

The heap decoder should consume captured memory evidence. This proof keeps the subset narrow and refuses unsupported captured shapes before target materialization.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Captured heap bytes are evidence for translation, not bytes to copy into a target V8 heap.

## Tasks

- [x] Add a captured-byte fixture format.
- [x] Decode Smi fields, packed-array edges, and shared identity from bytes.
- [x] Materialize target-native next state.
- [x] Refuse unsupported captured shapes before target start.
- [x] Keep byte-for-byte V8 heap restore out of scope.

## Proof result

`pnpm exec tsx proofs/060/smoke.ts` proves supported captured bytes decode into graph IR and return `{ count: 3, graphTotal: 3 }`, while dictionary, accessor, external-string, typed-array, and proxy shapes refuse.

## Validation

- [x] Run `pnpm exec tsx proofs/060/smoke.ts`.
- [x] Assert decoding uses captured bytes.
- [x] Assert unsupported shapes refuse before target start.
