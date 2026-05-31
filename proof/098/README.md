# Proof 098 — Native V8 decoder reads real guest memory mapping artifact

## TL;DR

Use the Zig guest-capture memory bytes together with captured map evidence before native V8 decoding.

## Track objective

This makes V8 recovery less artificial by requiring a real guest memory-map artifact and V8 mapping evidence from the capture records.

## Translated continuation north star

Captured guest memory and maps are evidence for target-native reconstruction. The target receives decoded graph state, not copied heap bytes.

## Tasks

- [x] Use Proof 096 Zig guest capture records as input.
- [x] Require captured map evidence for a V8 memory region.
- [x] Decode the captured memory bytes with the native V8 byte decoder.
- [x] Refuse missing V8 map evidence and invalid memory bytes before target start.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proof/098/smoke.ts` proves native V8 byte decoding is gated by captured V8 map evidence and returns `{ count: 3, graphTotal: 3 }`.

## Validation

- [x] Run `pnpm exec tsx proof/098/smoke.ts`.
- [x] Assert V8 map evidence is required.
- [x] Assert invalid map/memory evidence refuses before target start.
