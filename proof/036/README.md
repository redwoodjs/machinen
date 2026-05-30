# Proof 036 — Restore refusal gauntlet

## TL;DR

Build a gauntlet of unsafe source states and prove they fail closed. This protects the move toward CPU/register/heap continuation by making unsupported states explicit instead of accidentally treating metadata as success.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/036/`. The proof smoke test may be written in TypeScript, for example `proof/036/smoke.ts`, with an optional `proof/036/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/036/smoke.ts`.

## Goal

Prove a refusal-first matrix for the proper Node continuation track. Every unsafe or unsupported state should have a stable refusal code and should prevent target materialization. Accepted cases must still prove target-native reconstruction.

## Tasks

- [ ] Define refusal fixtures for active HTTP request, partial request body, partial response write, idle keep-alive ambiguity, active JS callback, active syscall, V8 GC/compiler frame, worker thread, native addon, multiple isolates, unsupported V8 object shape, unknown libuv handle, and architecture mismatch.
- [ ] Add stable refusal codes for every fixture.
- [ ] Ensure refused captures never start the target materializer.
- [ ] Ensure accepted quiescent fixtures still reconstruct target-native state.
- [ ] Emit a checked summary that separates accepted proof rows from refused rows.
- [ ] Assert no row claims product support or broad Level 5 implementation.
- [ ] Assert no forbidden shortcut is used in accepted or refused rows.

## Validation

- [ ] Run `pnpm exec tsx proof/036/smoke.ts`.
- [ ] Assert every unsafe fixture refuses with the expected stable code.
- [ ] Assert no refused fixture starts target materialization.
- [ ] Assert the accepted quiescent fixture still returns `{count:3}`.
- [ ] Assert checked summary taxonomy remains proof-only and not product support.
- [ ] Assert no app hooks, checkpoint API, selected-state descriptor, source ISA emulation, sidecar replay, or metadata-only success.
- [ ] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
