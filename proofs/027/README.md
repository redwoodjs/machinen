# Proof 027 — HTTP request and keep-alive state policy

## TL;DR

Define and prove the first safe policy for HTTP connection state. This is **not** runtime-aware snapshot/restore and not replay of HTTP output. The proof must either reconstruct safe idle state from captured process/kernel state or refuse unsafe active request state.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/027/`. The proof smoke test may be written in TypeScript, for example `proofs/027/smoke.ts`, with an optional `proofs/027/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/027/smoke.ts`.

## Status

Implemented by `proofs/027/smoke.ts` and run directly with `pnpm exec tsx proofs/027/smoke.ts`. The source app, Zig guest capture tool, and target loader live beside it as proof-local fixture files.

## Goal

Teach the proper Node Level 5 proof to distinguish quiescent HTTP listener state from active request/connection state. First, fail closed for active requests. Then support idle keep-alive sockets when their state is fully understood.

Proof 027 should also replace the proof-local Perl guest capture program with a Zig guest capture tool, so process, socket, and memory capture logic moves into the systems language we expect to keep growing.

## Tasks

- [x] Convert the proof-local guest capture program to Zig before extending the capture surface.
- [x] Capture TCP listener state and accepted socket/fd state from `/proc` and kernel tables.
- [x] Detect the proof's active HTTP request fixture from captured source memory.
- [x] Add stable refusal codes for active, partial, or ambiguous request state, with this proof smoking the active-request refusal path.
- [x] Add an idle keep-alive model only when socket buffers and Node/libuv stream state are safe.
- [x] Extend the portable IR with listener, idle connection, and refusal evidence.
- [x] Materialize target-native listener state without replaying source responses.

## Proof result

`pnpm exec tsx proofs/027/smoke.ts` now proves:

- active in-flight `/hold` request state is detected from captured source memory and refuses with `node-proper-level5-http-active-request-unsupported`;
- quiescent listener state is captured by `proofs/027/guest-capture.zig` from `/proc`, memory mappings, fd links, and TCP tables;
- source returns `{ "count": 1 }`, then `{ "count": 2 }` before capture;
- target-native Node reconstructs count from raw V8 context Smi state and returns `{ "count": 3 }`;
- idle keep-alive policy is safe close/recreate on the target; no source response replay or source ISA emulation is used.

## Validation

- [x] Add tests for active request refusal.
- [x] Add tests for idle keep-alive classification.
- [x] Run a smoke proof where an active in-flight request refuses.
- [x] Run a smoke proof where quiescent listener continuation still returns `{count:3}`.
- [x] If idle keep-alive is implemented, prove the target can reuse or safely close/recreate the idle socket according to the IR policy.
- [x] Assert no app hooks, no checkpoint API, no selected-state descriptor, no source ISA emulation, no sidecar replay, and no metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
