# Proof 032 — Thread continuation classification

## TL;DR

Classify where each source thread stopped. The proof must distinguish safe event-loop wait points from unsafe JavaScript, V8, native, syscall, GC, or HTTP parser continuations. Unsupported states must refuse before any target materialization.

## Track objective

The actual goal is to decide whether a captured source point is safe for target-native semantic reconstruction. Accepted rows get continuation descriptors; unsafe rows refuse. This classifier prevents raw registers, stacks, active callbacks, or syscalls from being treated as restored just because they were captured.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/032/`. The proof smoke test may be written in TypeScript, for example `proofs/by-id/032/smoke.ts`, with an optional `proofs/by-id/032/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/by-id/032/smoke.ts`.

## Goal

Prove a refusal-first continuation classifier for the proper Node track. A source capture should be accepted only when all threads are at known safe points that can be reconstructed target-natively. Unsafe in-flight continuations must produce stable refusal codes.

## Tasks

- [x] Define continuation classes: event-loop wait, timer callback active, HTTP request callback active, V8 internal frame, GC/compiler frame, native addon frame, active syscall, unknown.
- [x] Capture enough thread/register/syscall evidence to assign each thread to a class.
- [x] Accept the narrow idle event-loop wait case used by the current HTTP counter proof.
- [x] Refuse active JavaScript callback execution with a stable code.
- [x] Refuse active syscall states that are not modeled.
- [x] Refuse V8 GC/compiler/internal frames and unknown native frames in the taxonomy so future captures fail closed instead of becoming raw continuation claims.
- [x] Emit continuation descriptors only for accepted safe points.

## Proof result

`pnpm exec tsx proofs/by-id/032/smoke.ts` now proves:

- idle listener capture is accepted and emits thread continuation descriptors;
- target-native reconstruction still recovers the raw V8 context Smi counter and returns `{ "count": 3 }`;
- active `/hold` HTTP request state refuses with `node-proper-level5-http-active-request-unsupported`;
- an intentional busy JavaScript callback fixture refuses with `node-proper-level5-active-js-callback-unsupported`;
- an intentional blocking syscall fixture refuses with `node-proper-level5-active-syscall-unsupported`;
- refused captures include refusal evidence in the portable IR and emit no target continuation descriptors;
- no target materialization occurs for refused captures.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/032/smoke.ts`.
- [x] Assert idle listener capture is accepted and target returns `{count:3}`.
- [x] Assert active `/hold` HTTP request refuses.
- [x] Assert an intentional busy JS callback fixture refuses.
- [x] Assert an intentional blocking syscall fixture refuses unless it has an explicit modeled continuation.
- [x] Assert refusal evidence appears in the portable IR and no target materialization occurs for refused captures.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
