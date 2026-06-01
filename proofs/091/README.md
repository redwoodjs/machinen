# Proof 091 — Real guest capture records

## TL;DR

Replace proof-shaped section artifacts with guest-capture record files that carry capture identity, digests, process evidence, and captured memory bytes.

## Track objective

This targets the first remaining product blocker: real guest capture. The proof still runs locally, but the bundle inputs now look like capture records rather than TypeScript section literals.

## Translated continuation north star

The goal is **translated continuation**. Guest capture records are evidence for target-native reconstruction; source memory and CPU state are not copied into the target.

## Tasks

- [x] Emit guest-capture record files for process, maps, fd table, threads, tcp state, and memory bytes.
- [x] Validate capture identity, capture tool, and digests.
- [x] Feed captured memory bytes into the native V8 byte decoder.
- [x] Refuse missing or stale capture records before target start.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proofs/091/smoke.ts` proves guest-capture records drive native V8 byte recovery and return `{ count: 3, graphTotal: 3 }`, while missing or stale records refuse.

## Validation

- [x] Run `pnpm exec tsx proofs/091/smoke.ts`.
- [x] Assert guest-capture records replace proof-shaped artifacts.
- [x] Assert invalid records refuse before target start.
