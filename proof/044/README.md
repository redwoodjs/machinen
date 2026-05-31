# Proof 044 — Real-evidence thread state classifier

## TL;DR

Move thread continuation classification away from proof markers and toward real captured evidence: `/proc/<pid>/task/*/syscall`, thread status/stat, stack ranges, maps, and module identity.

## Track objective

The actual goal is a stronger refusal-first classifier. It should accept known safe event-loop wait points only when real thread evidence supports that class, and refuse unknown/native/V8/internal frames before target materialization.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/044/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/044/smoke.ts`; do not add a root `package.json` script.

## Goal

Classify thread continuation state from captured process/thread evidence rather than fixture-only markers. Accepted rows get continuation descriptors; unsupported rows get stable refusal codes and no materialization.

## Tasks

- [x] Capture modeled per-thread syscall, status, stat, wchan, fd, stack-range, maps, and module identity evidence.
- [x] Define evidence rules for `node-libuv-event-loop-wait-v1`.
- [x] Define fail-closed rules for active JS frames, active syscalls, active requests, unknown waits, and running threads.
- [x] Emit classification evidence for every thread.
- [x] Emit continuation descriptors only for accepted safe points.
- [x] Prove refused captures do not start materialization.
- [x] Keep marker-only classification as insufficient for acceptance.

## Proof result

`pnpm exec tsx proof/044/smoke.ts` now proves:

- evidence shaped like procfs thread/status/syscall/wchan/fd data drives classification;
- idle libuv epoll wait accepts as `node-libuv-event-loop-wait-v1`;
- active request, active JS callback, blocking read syscall, running thread, and unknown wait refuse with stable codes;
- registers, PC, and stack remain evidence only, with no runtime-level profile path.

## Validation

- [x] Run `pnpm exec tsx proof/044/smoke.ts`.
- [x] Assert idle event-loop wait is accepted from real evidence.
- [x] Assert active JS/syscall/native/unknown states refuse.
- [x] Assert every thread has classification evidence.
- [x] Assert no raw source PC/register/stack copy, source ISA emulation, sidecar replay, or metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
