# Proof 102 — Real capture negative gauntlet

## TL;DR

Run invalid real-capture variants through the native gates and prove they refuse before target start.

## Track objective

The accepted Proof 100 path is only useful if nearby shortcuts fail. This proof tampers with real-capture records and memory bytes to keep the boundary honest.

## Translated continuation north star

Invalid evidence must not be materialized. Refusals happen before any target-native Node process starts.

## Tasks

- [x] Accept an untampered Zig guest capture through the native record parser.
- [x] Refuse missing records.
- [x] Refuse bad schema kind.
- [x] Refuse bad capture-tool identity.
- [x] Refuse invalid memory bytes.

## Proof result

`pnpm exec tsx proof/102/smoke.ts` proves the real-capture negative gauntlet refuses all invalid rows before target start.

## Validation

- [x] Run `pnpm exec tsx proof/102/smoke.ts`.
- [x] Assert every invalid row has a typed refusal.
- [x] Assert every invalid row stops before target start.
