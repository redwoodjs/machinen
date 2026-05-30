# Proof 034 — Cross-architecture continuation descriptor

## TL;DR

Translate a captured source continuation into a target-native continuation descriptor. This is not copying arm64 registers into amd64, and not source ISA emulation. It is a proof that known safe source PCs/registers/stack facts can become a target-native landing plan.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/034/`. The proof smoke test may be written in TypeScript, for example `proof/034/smoke.ts`, with an optional `proof/034/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/034/smoke.ts`.

## Goal

Prove the first narrow cross-architecture continuation descriptor for a safe Node event-loop wait point. The target should enter an equivalent target-native event loop wait/dispatch path using a descriptor derived from source machine/process state.

## Tasks

- [ ] Capture source PC/register/syscall/thread evidence at a known safe event-loop wait point.
- [ ] Resolve source code location to a semantic continuation class, not a raw target PC.
- [ ] Emit an architecture-neutral continuation descriptor for `node-libuv-event-loop-wait-v1`.
- [ ] Map the descriptor to a target-native landing plan on the opposite architecture.
- [ ] Prove the target does not execute source ISA bytes and does not emulate source code.
- [ ] Refuse unknown PCs, active JS frames, V8 internal frames, and unsupported native frames.
- [ ] Keep app state reconstruction separate from continuation landing evidence.

## Validation

- [ ] Run `pnpm exec tsx proof/034/smoke.ts`.
- [ ] Assert source and target architectures differ.
- [ ] Assert source continuation class is `node-libuv-event-loop-wait-v1`.
- [ ] Assert target enters a target-native event loop path and returns `{count:3}`.
- [ ] Assert source raw registers are not copied as target registers across architectures.
- [ ] Assert no source ISA emulation, no sidecar replay, no metadata-only success, and no app export/import.
- [ ] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
