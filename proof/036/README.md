# Proof 036 — Restore refusal gauntlet

## TL;DR

Build a gauntlet of unsafe source states and prove they fail closed. This protects the move toward CPU/register/heap continuation by making unsupported states explicit instead of accidentally treating metadata as success.

## Track objective

The actual goal is to protect the proof track from false success. The gauntlet should prove that unsupported captured state refuses before target materialization, while supported quiescent state still reconstructs target-natively. Refusal evidence is part of the proof, not a failure of the product path.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/036/`. The proof smoke test may be written in TypeScript, for example `proof/036/smoke.ts`, with an optional `proof/036/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/036/smoke.ts`.

## Goal

Prove a refusal-first matrix for the proper Node continuation track. Every unsafe or unsupported state should have a stable refusal code and should prevent target materialization. Accepted cases must still prove target-native reconstruction.

## Tasks

- [x] Define refusal fixtures for active HTTP request, partial request body, partial response write, idle keep-alive ambiguity, active JS callback, active syscall, V8 GC/compiler frame, worker thread, native addon, multiple isolates, unsupported V8 object shape, unknown libuv handle, and architecture mismatch.
- [x] Add stable refusal codes for every fixture.
- [x] Ensure refused captures never start the target materializer.
- [x] Ensure accepted idle fixtures still reconstruct target-native state.
- [x] Emit a checked summary that separates accepted proof rows from refused rows.
- [x] Assert no row claims product support or broad Level 5 implementation.
- [x] Assert no forbidden shortcut is used in accepted or refused rows.

## Proof result

`pnpm exec tsx proof/036/smoke.ts` now proves:

- all 13 unsafe fixtures refuse with stable codes;
- refused rows do not start target materialization;
- the accepted idle row still materializes target-native state and returns `{ "count": 3 }`;
- `proof/036/checked-summary.json` separates accepted rows from refused rows;
- the checked summary is explicitly proof-only and claims no product support or broad Level 5 implementation;
- no app hook, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, or metadata-only success is used by any row.

## Validation

- [x] Run `pnpm exec tsx proof/036/smoke.ts`.
- [x] Assert every unsafe fixture refuses with the expected stable code.
- [x] Assert no refused fixture starts target materialization.
- [x] Assert the accepted idle fixture still returns `{count:3}`.
- [x] Assert checked summary taxonomy remains proof-only and not product support.
- [x] Assert no app hooks, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, or metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
