# Proof 033 — V8 heap graph translator expansion

## TL;DR

Expand from tiny V8 state shapes to a small heap graph translator. The proof should recover multiple linked plain objects, arrays, strings, and closure context cells from captured V8 memory, then rebuild equivalent target-native objects. Unsupported V8 shapes must refuse.

## Track objective

The actual goal is to grow the semantic state that can be translated from raw V8 memory evidence into target-native V8 objects. This is heap graph reconstruction for supported shapes, not a byte-for-byte V8 heap restore. Unsupported maps, elements kinds, strings, or object shapes must refuse.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/033/`. The proof smoke test may be written in TypeScript, for example `proof/033/smoke.ts`, with an optional `proof/033/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/033/smoke.ts`.

## Goal

Prove a small but real object graph translation boundary beyond `{ total, history }`. The target must reconstruct equivalent target-native V8 objects from captured source heap graph evidence, not from app export/import or prior response strings.

## Tasks

- [ ] Define supported V8 graph nodes: Smi, heap number if needed, internalized/one-byte strings, plain object, packed Smi array, packed object array, closure context cell.
- [ ] Capture object references and edges near retained proof anchors.
- [ ] Decode object maps/hidden classes enough to distinguish supported plain objects from unsupported shapes.
- [ ] Decode properties, array lengths, array elements, and object references into a portable graph IR.
- [ ] Reconstruct target-native object graph with identity preservation for shared references.
- [ ] Refuse sparse arrays, accessors, proxies, symbols, external strings, unsupported elements kinds, unknown maps, and ambiguous graphs.
- [ ] Prove prior JSON response strings are not used as the source of truth.

## Validation

- [ ] Run `pnpm exec tsx proof/033/smoke.ts`.
- [ ] Assert source mutates a linked object graph before capture.
- [ ] Assert target returns the next response from reconstructed graph state.
- [ ] Assert object identity/shared-reference evidence is preserved when included in the fixture.
- [ ] Assert unsupported shapes refuse with stable codes.
- [ ] Assert no app hooks, checkpoint API, selected-state descriptor, sidecar replay, source ISA emulation, or metadata-only success.
- [ ] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
