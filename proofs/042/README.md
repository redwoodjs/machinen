# Proof 042 — V8 heap graph layout decoder expansion

## TL;DR

Make the heap graph proof less anchor-shaped. Decode more actual V8 object layout evidence for supported objects, arrays, strings, maps, and edges, while keeping unsupported shapes fail-closed.

## Track objective

The actual goal is to replace proof-specific string proximity with a stronger supported-shape heap graph decoder. This is still semantic graph translation for narrow V8 shapes, not byte-for-byte heap restore or product support.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/042/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/042/smoke.ts`; do not add a root `package.json` script.

## Goal

Decode a richer supported V8 heap graph from raw memory evidence with fewer fixture-specific assumptions. Unsupported maps, elements kinds, accessors, proxies, symbols, external strings, sparse arrays, and ambiguous references must refuse.

## Tasks

- [x] Define supported object layout evidence for plain objects, packed arrays, one-byte strings, Smi fields, and shared references.
- [x] Decode object map evidence enough to distinguish supported and unsupported shapes in the proof-local layout format.
- [x] Decode property slots, array lengths, array elements, and reference edges into graph IR.
- [x] Preserve shared-reference identity in target materialization.
- [x] Add unsupported-shape fixtures and stable refusal codes.
- [x] Prove prior JSON responses and app exports are not used as source of truth.
- [x] Keep byte-for-byte V8 heap restore explicitly out of scope.

## Proof result

`pnpm exec tsx proofs/042/smoke.ts` now proves:

- a proof-local raw layout buffer decodes into supported heap graph IR;
- the target materialization returns the next graph state with total `3`;
- shared references are preserved across object properties and packed-array elements;
- proxy, sparse-array, and unknown-map variants refuse with stable codes;
- prior JSON responses and app exports are not used as source of truth.

## Validation

- [x] Run `pnpm exec tsx proofs/042/smoke.ts`.
- [x] Assert supported graph decodes from raw memory evidence and materializes target-natively.
- [x] Assert shared-reference identity is preserved.
- [x] Assert unsupported shapes refuse with stable codes.
- [x] Assert no app hooks, checkpoint API, selected-state descriptor, sidecar replay, source ISA emulation, or metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
