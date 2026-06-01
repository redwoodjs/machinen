# Proof 043 — Native resource descriptor expansion

## TL;DR

Expand native resource materialization beyond one listener and one simple timer. Add more libuv resource descriptors and stricter refusal for ambiguous kernel/libuv state.

## Track objective

The actual goal is to grow target-native resource recreation from portable descriptors while keeping source kernel objects as evidence only. Every unsupported or ambiguous resource state must refuse before target materialization.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/043/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/by-id/043/smoke.ts`; do not add a root `package.json` script.

## Goal

Add more native resource descriptors and prove they either materialize target-natively or refuse with stable codes. The proof should keep listener/timer materialization working while expanding the refusal boundary.

## Tasks

- [x] Add descriptors for TCP listener, repeating timer, pending timeout, and eventfd counter.
- [x] Model fd table, `/proc/net/*`, timer/resource markers, and resource inventory evidence in proof descriptors.
- [x] Materialize supported resources as fresh target-native handles.
- [x] Refuse connected sockets with unread bytes, pending writes, epoll ambiguity, fs watchers, DNS requests, and unknown handles.
- [x] Prove source kernel fds and libuv handles are not reused on target.
- [x] Attach resource descriptor provenance to the composed bundle summary.
- [x] Keep app state reconstruction separate from resource materialization evidence.

## Proof result

`pnpm exec tsx proofs/by-id/043/smoke.ts` now proves:

- listener, repeating timer, pending timeout, and eventfd descriptors materialize target-natively;
- the target listener responds with the next count and timer/eventfd evidence;
- connected sockets with unread bytes, pending writes, epoll, fs watcher, DNS request, and source fd copy refuse with stable codes;
- source kernel fds and libuv handles are never reused on target.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/043/smoke.ts`.
- [x] Assert supported resource descriptors materialize target-natively.
- [x] Assert ambiguous/unsupported resources refuse with stable codes.
- [x] Assert target listener and timer continue after materialization.
- [x] Assert no source fd reuse, source libuv handle copy, source ISA emulation, sidecar replay, or metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
