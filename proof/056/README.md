# Proof 056 — Capture tool emits real section artifacts

## TL;DR

Move Proof 047 from modeled artifacts to files emitted by a proof-local capture tool.

## Track objective

The translated-continuation bundle should be assembled from capture-tool output files, not hand-written objects. This proof keeps the scope proof-only while making every required section come from a tool invocation.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof live under `proof/056/`. Run with `pnpm exec tsx proof/056/smoke.ts`; do not add a root `package.json` script.

## Tasks

- [x] Add a proof-local capture tool that emits section artifact files.
- [x] Assemble the translated-continuation bundle only from emitted files.
- [x] Verify artifact generator, digest, and hand-authored flags.
- [x] Refuse missing or tampered artifacts before target start.
- [x] Keep proof-only status explicit and avoid product support claims.

## Proof result

`pnpm exec tsx proof/056/smoke.ts` proves capture-tool output files feed the bundle, target state advances to `{ count: 3, graphTotal: 3 }`, and invalid artifacts refuse before target start.

## Validation

- [x] Run `pnpm exec tsx proof/056/smoke.ts`.
- [x] Assert all required sections come from capture-tool output files.
- [x] Assert missing/tampered artifacts refuse before target start.
- [x] Assert no app export/import, checkpoint hook, source ISA emulation, sidecar replay, raw CPU copy, or metadata-only success.
