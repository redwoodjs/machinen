# Proof 052 — Expanded native resource descriptors

## TL;DR

Add more safe libuv/kernel resources and sharper refusal boundaries.

## Track objective

Grow the resource descriptor set without reusing source kernel resources. Supported resources must be reconstructed as fresh target-native handles; ambiguous or stateful resources must refuse.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/052/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proofs/by-id/052/smoke.ts`; do not add a root `package.json` script.

## Goal

Grow the resource descriptor set without reusing source kernel resources. Supported resources must be reconstructed as fresh target-native handles; ambiguous or stateful resources must refuse.

## Tasks

- [x] Add safe descriptors for a small additional set of handles such as idle/prepare/check handles, signal-like descriptors, or pipe/listener variants when evidence is complete.
- [x] Record fd table, `/proc/net/*`, timer/resource markers, readiness, queue, and ownership evidence for each descriptor.
- [x] Materialize supported resources as fresh target-native handles.
- [x] Refuse unread bytes, pending writes, partial transfers, epoll ambiguity, fs watchers, DNS requests, unknown handles, and source fd/libuv handle copying.
- [x] Attach provenance and verifier policy to every resource descriptor.
- [x] Keep app state reconstruction separate from resource materialization evidence.

## Proof result

`pnpm exec tsx proofs/by-id/052/smoke.ts` proves expanded supported resource descriptors materialize as fresh target-native handles and unsafe/ambiguous resources refuse before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/052/smoke.ts`.
- [x] Assert supported resource descriptors materialize target-natively.
- [x] Assert unsupported or ambiguous resources refuse with stable codes before target start.
- [x] Assert no source fd, kernel object, or libuv handle is reused on target.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
