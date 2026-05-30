# Proof 050 — V8 decoder expansion

## TL;DR

Decode more real V8 heap evidence and refuse more unsupported shapes.

## Track objective

Expand the supported heap graph subset while staying fail-closed. The proof should decode more maps/properties/arrays/strings from captured bytes and produce graph IR only for understood shapes.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/050/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/050/smoke.ts`; do not add a root `package.json` script.

## Goal

Expand the supported heap graph subset while staying fail-closed. The proof should decode more maps/properties/arrays/strings from captured bytes and produce graph IR only for understood shapes.

## Tasks

- [x] Add fixtures for additional V8 map/property layouts, packed arrays, strings, closure cells, and shared references.
- [x] Decode property slots, element backing stores, lengths, tags, and reference edges into graph IR.
- [x] Add stable refusals for dictionary-mode objects, accessors, symbols, external strings, typed arrays, weak refs, proxies, sparse arrays, and unknown maps.
- [x] Preserve shared-reference identity in target materialization.
- [x] Prove prior JSON responses and app exports are not used as source of truth.
- [x] Keep byte-for-byte heap restore out of scope.

## Proof result

`pnpm exec tsx proof/050/smoke.ts` proves the expanded V8 layout decoder accepts the supported graph subset, preserves shared identity, returns the next state, and refuses nine unsupported shape classes before materialization.

## Validation

- [x] Run `pnpm exec tsx proof/050/smoke.ts`.
- [x] Assert supported layouts decode from raw/captured heap evidence into graph IR.
- [x] Assert target materialization preserves identity and returns the next graph state.
- [x] Assert every unsupported shape refuses with a stable code before materialization.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
