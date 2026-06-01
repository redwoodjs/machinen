# Proof 051 — Multi-thread continuation classifier

## TL;DR

Classify all Node threads together and refuse if any thread is unsafe.

## Track objective

Move from single-thread examples to whole-process thread safety. A continuation descriptor should be emitted only when every thread has real evidence and every thread is accepted or known-safe idle support work.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/051/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/051/smoke.ts`; do not add a root `package.json` script.

## Goal

Move from single-thread examples to whole-process thread safety. A continuation descriptor should be emitted only when every thread has real evidence and every thread is accepted or known-safe idle support work.

## Tasks

- [x] Capture status/stat/syscall/wchan/fd/map evidence for every source thread.
- [x] Classify main event-loop thread, worker/helper threads, signal-related waits, and unknown/native waits separately.
- [x] Emit a whole-process decision that accepts only if all required threads are safe.
- [x] Refuse active JS, active requests, blocking syscalls, unknown PCs, ambiguous stacks, native addon frames, and unsafe helper-thread states.
- [x] Include evidence and refusal code for every thread.
- [x] Keep registers, PCs, and stacks as evidence only, not target restore bytes.

## Proof result

`pnpm exec tsx proofs/051/smoke.ts` proves an all-safe thread set emits a whole-process continuation descriptor and that one unsafe thread causes a whole-process refusal before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/051/smoke.ts`.
- [x] Assert an all-safe idle process emits a continuation descriptor.
- [x] Assert one unsafe thread causes whole-process refusal before target start.
- [x] Assert every thread has classification evidence and stable accept/refusal status.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
