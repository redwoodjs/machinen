# Proof 033 — V8 heap graph translator expansion

## TL;DR

Expand from tiny V8 state shapes to a small heap graph translator. The proof should recover multiple linked plain objects, arrays, strings, and closure context cells from captured V8 memory, then rebuild equivalent target-native objects. Unsupported V8 shapes must refuse.

## Track objective

The actual goal is to grow the semantic state that can be translated from raw V8 memory evidence into target-native V8 objects. This is heap graph reconstruction for supported shapes, not a byte-for-byte V8 heap restore. Unsupported maps, elements kinds, strings, or object shapes must refuse.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/033/`. The proof smoke test may be written in TypeScript, for example `proofs/by-id/033/smoke.ts`, with an optional `proofs/by-id/033/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/by-id/033/smoke.ts`.

## Goal

Prove a small but real object graph translation boundary beyond `{ total, history }`. The target must reconstruct equivalent target-native V8 objects from captured source heap graph evidence, not from app export/import or prior response strings.

## Tasks

- [x] Define supported V8 graph nodes: Smi, one-byte strings, plain object, packed Smi/object array, and closure context cell.
- [x] Capture object references and edges near retained proof anchors.
- [x] Decode enough shape evidence to distinguish the supported plain-object fixture from unsupported proxy/sparse-array shapes.
- [x] Decode supported properties, array lengths, array elements, and object references into a portable graph IR.
- [x] Reconstruct target-native object graph with identity preservation for shared references.
- [x] Refuse sparse arrays/proxies and keep accessors, symbols, external strings, unsupported elements kinds, unknown maps, and ambiguous graphs in the fail-closed unsupported set.
- [x] Prove prior JSON response strings are not used as the source of truth.

## Proof result

`pnpm exec tsx proofs/by-id/033/smoke.ts` now proves:

- the source mutates a linked heap graph to `{ total: 2, historyLength: 2 }` before capture;
- raw V8 memory evidence contains the graph anchor, history strings, shared-leaf string, and closure-context Smi total;
- the target materializes target-native plain objects, packed arrays, strings, and a closure-context cell from a portable heap graph IR;
- shared-reference identity is preserved: `left.shared`, `right.shared`, and `packed[2]` point to the same target object;
- the target returns the next graph response with `{ total: 3, historyLength: 3 }`;
- active HTTP, busy JavaScript, active syscall, and unsupported proxy/sparse-array captures refuse with stable codes before target materialization;
- prior JSON response strings, app hooks, checkpoint API, selected-state descriptors, sidecar replay, source ISA emulation, and metadata-only success are not used.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/033/smoke.ts`.
- [x] Assert source mutates a linked object graph before capture.
- [x] Assert target returns the next response from reconstructed graph state.
- [x] Assert object identity/shared-reference evidence is preserved when included in the fixture.
- [x] Assert unsupported shapes refuse with stable codes.
- [x] Assert no app hooks, checkpoint API, selected-state descriptor, sidecar replay, source ISA emulation, or metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
