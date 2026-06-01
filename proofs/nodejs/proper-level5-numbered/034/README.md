# Proof 034 — Cross-architecture continuation descriptor

## TL;DR

Translate a captured source continuation into a target-native continuation descriptor. This is not copying arm64 registers into amd64, and not source ISA emulation. It is a proof that known safe source PCs/registers/stack facts can become a target-native landing plan.

## Track objective

The actual goal is an architecture-neutral continuation descriptor derived from captured source machine/process state. The target should land in an equivalent target-native continuation, not copy source registers or execute source ISA bytes. This is the bridge from semantic reconstruction toward real continuation.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/034/`. The proof smoke test may be written in TypeScript, for example `proofs/by-id/034/smoke.ts`, with an optional `proofs/by-id/034/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/by-id/034/smoke.ts`.

## Goal

Prove the first narrow cross-architecture continuation descriptor for a safe Node event-loop wait point. The target should enter an equivalent target-native event loop wait/dispatch path using a descriptor derived from source machine/process state.

## Tasks

- [x] Capture source PC/register/syscall/thread evidence at a known safe event-loop wait point.
- [x] Resolve source code location to a semantic continuation class, not a raw target PC.
- [x] Emit an architecture-neutral continuation descriptor for `node-libuv-event-loop-wait-v1`.
- [x] Map the descriptor to a target-native landing plan on the opposite architecture.
- [x] Prove the target does not execute source ISA bytes and does not emulate source code.
- [x] Refuse unknown PCs, active JS frames, V8 internal frames, and unsupported native frames in the descriptor policy so they fail closed instead of becoming raw continuation claims.
- [x] Keep app state reconstruction separate from continuation landing evidence.

## Proof result

`pnpm exec tsx proofs/by-id/034/smoke.ts` now proves:

- the source VM runs on arm64 and the target runs target-native amd64;
- source thread/status/stat/syscall evidence is captured as evidence for translation;
- the source continuation is classified as `node-libuv-event-loop-wait-v1`;
- the portable IR carries an architecture-neutral continuation descriptor with raw source PC/register/stack copy disabled;
- the target maps that descriptor to a target-native Node/libuv event-loop landing plan;
- target-native reconstruction still recovers the counter from raw V8 context Smi evidence and returns `{ "count": 3 }`;
- no source ISA bytes are executed, no source ISA emulation is used, and app state reconstruction stays separate from continuation landing evidence.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/034/smoke.ts`.
- [x] Assert source and target architectures differ.
- [x] Assert source continuation class is `node-libuv-event-loop-wait-v1`.
- [x] Assert target enters a target-native event loop path and returns `{count:3}`.
- [x] Assert source raw registers are not copied as target registers across architectures.
- [x] Assert no source ISA emulation, no sidecar replay, no metadata-only success, and no app export/import.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
