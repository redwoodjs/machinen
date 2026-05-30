# Proof 027 — HTTP request and keep-alive state policy

## TL;DR

Define and prove the first safe policy for HTTP connection state. This is **not** runtime-aware snapshot/restore and not replay of HTTP output. The proof must either reconstruct safe idle state from captured process/kernel state or refuse unsafe active request state.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/027/`. The proof smoke test may be written in TypeScript, for example `proof/027/smoke.ts`, with an optional `proof/027/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proof/027/smoke.ts`.

## Goal

Teach the proper Node Level 5 proof to distinguish quiescent HTTP listener state from active request/connection state. First, fail closed for active requests. Then support idle keep-alive sockets when their state is fully understood.

## Tasks

- Capture TCP listener state and accepted socket/fd state from `/proc` and kernel tables.
- Detect active HTTP requests, partial reads/writes, pending response bytes, and active libuv stream callbacks.
- Add stable refusal codes for active or ambiguous request state.
- Add an idle keep-alive model only when socket buffers and Node/libuv stream state are safe.
- Extend the portable IR with listener, idle connection, and refusal evidence.
- Materialize target-native listener state without replaying source responses.

## Validation

- Add tests for active request refusal.
- Add tests for idle keep-alive classification.
- Run a smoke proof where an active in-flight request refuses.
- Run a smoke proof where quiescent listener continuation still returns `{count:3}`.
- If idle keep-alive is implemented, prove the target can reuse or safely close/recreate the idle socket according to the IR policy.
- Assert no app hooks, no checkpoint API, no selected-state descriptor, no source ISA emulation, no sidecar replay, and no metadata-only success.
- Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
