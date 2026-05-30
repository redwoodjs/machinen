# Proof 092 — V8 object recovery with build gates

## TL;DR

Recover a small object state only when the captured Node/V8 build identity and encoding assumptions are supported.

## Track objective

This targets the second remaining product blocker: reliable V8 heap/object recovery across supported builds. The proof is still narrow, but it makes build identity and encoding gates explicit.

## Translated continuation north star

Captured V8 bytes, maps, and build identity are evidence for translation. The target rebuilds native JS state instead of copying heap bytes.

## Tasks

- [x] Add a supported Node/V8 build identity gate.
- [x] Decode object total and history values from captured-byte-shaped records.
- [x] Preserve shared-reference identity in graph IR.
- [x] Refuse unsupported V8 versions, encodings, and maps before target start.
- [x] Keep app export/import out of scope.

## Proof result

`pnpm exec tsx proof/092/smoke.ts` proves a supported Node 22 / V8 12 style record reconstructs `{ total: 3, history: [1, 2, 3] }`, while unsupported builds, encodings, and maps refuse.

## Validation

- [x] Run `pnpm exec tsx proof/092/smoke.ts`.
- [x] Assert build identity gates are required.
- [x] Assert unsupported V8 records refuse before target start.
