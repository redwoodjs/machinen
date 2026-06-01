# Proof 096 — Real guest-capture Zig emits record files

## TL;DR

Have a Zig guest-capture-style tool emit the capture record files used by the translated-continuation path.

## Track objective

This makes the capture boundary less artificial than TypeScript-generated artifacts. The proof still stays local, but the records come from Zig and include process, map, fd, thread, TCP, and memory-byte evidence.

## Translated continuation north star

The goal is **translated continuation**. Guest capture records are evidence for translation and target-native reconstruction; they are not target bytes to copy.

## Tasks

- [x] Add a Zig guest-capture-style emitter.
- [x] Emit process, maps, fd table, threads, TCP, and V8 memory-byte records.
- [x] Validate record shape and capture-tool identity.
- [x] Decode captured memory bytes with the native V8 byte decoder.
- [x] Refuse missing records before target start.

## Proof result

`pnpm exec tsx proofs/by-id/096/smoke.ts` proves the Zig capture emitter produces required records and native V8 byte decoding returns `{ count: 3, graphTotal: 3 }`.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/096/smoke.ts`.
- [x] Assert capture records come from Zig.
- [x] Assert invalid records refuse before target start.
