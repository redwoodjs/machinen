# Proof 032 — Thread continuation classification

## TL;DR

Classify where each source thread stopped. The proof must distinguish safe event-loop wait points from unsafe JavaScript, V8, native, syscall, GC, or HTTP parser continuations. Unsupported states must refuse before any target materialization.

## Track objective

The actual goal is to decide whether a captured source point is safe for target-native semantic reconstruction. Accepted rows get continuation descriptors; unsafe rows refuse. This classifier prevents raw registers, stacks, active callbacks, or syscalls from being treated as restored just because they were captured.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/032/`. The proof smoke test may be written in TypeScript, for example `proof/032/smoke.ts`, with an optional `proof/032/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/032/smoke.ts`.

## Goal

Prove a refusal-first continuation classifier for the proper Node track. A source capture should be accepted only when all threads are at known safe points that can be reconstructed target-natively. Unsafe in-flight continuations must produce stable refusal codes.

## Tasks

- [ ] Define continuation classes: event-loop wait, timer callback active, HTTP request callback active, V8 internal frame, GC/compiler frame, native addon frame, active syscall, unknown.
- [ ] Capture enough thread/register/syscall evidence to assign each thread to a class.
- [ ] Accept the narrow quiescent event-loop wait case used by the current HTTP counter proof.
- [ ] Refuse active JavaScript callback execution with a stable code.
- [ ] Refuse active syscall states that are not modeled.
- [ ] Refuse V8 GC/compiler/internal frames and unknown native frames.
- [ ] Emit continuation descriptors only for accepted safe points.

## Validation

- [ ] Run `pnpm exec tsx proof/032/smoke.ts`.
- [ ] Assert quiescent listener capture is accepted and target returns `{count:3}`.
- [ ] Assert active `/hold` HTTP request refuses.
- [ ] Assert an intentional busy JS callback fixture refuses.
- [ ] Assert an intentional blocking syscall fixture refuses unless it has an explicit modeled continuation.
- [ ] Assert refusal evidence appears in the portable IR and no target materialization occurs for refused captures.
- [ ] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
