# Proof 047 — Real capture-emitted translated bundle

## TL;DR

Replace proof-built mock sections with sections emitted directly by source capture tools.

## Track objective

Move the bundle closer to real capture output. The source capture path should emit heap, continuation, resource, thread, and provenance sections as artifacts that the bundle assembler consumes without hand-authored proof literals.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/047/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/047/smoke.ts`; do not add a root `package.json` script.

## Goal

Move the bundle closer to real capture output. The source capture path should emit heap, continuation, resource, thread, and provenance sections as artifacts that the bundle assembler consumes without hand-authored proof literals.

## Tasks

- [x] Extend capture tooling to emit section artifacts for heap graph evidence, continuation evidence, resources, threads, and architecture identity.
- [x] Assemble the translated-continuation bundle only from emitted artifacts.
- [x] Record artifact paths, digests, generator identity, and capture timestamps for each section.
- [x] Refuse missing, stale, or hand-authored replacement sections before materialization.
- [x] Keep source registers, PC, stack, fds, and libuv handles as evidence only.
- [x] Keep proof-only status explicit and avoid product support claims.

## Proof result

`pnpm exec tsx proofs/047/smoke.ts` proves that all bundle sections come from capture-emitted artifacts, that missing/stale/hand-authored sections refuse before target start, and that the accepted bundle target returns `{ count: 3, graphTotal: 3 }`.

## Validation

- [x] Run `pnpm exec tsx proofs/047/smoke.ts`.
- [x] Assert every bundle section comes from a capture-emitted artifact.
- [x] Assert missing/stale/hand-authored section artifacts refuse before target start.
- [x] Assert target-native reconstruction still returns the next state for the accepted bundle.
- [x] Assert no app export/import, checkpoint hook, source ISA emulation, sidecar replay, raw CPU copy, or metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
