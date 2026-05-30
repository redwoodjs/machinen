# Proof 048 — Native verifier hardening

## TL;DR

Move more schema, digest, and shortcut checks into the native verifier.

## Track objective

Make the verifier fail closed before any Node target process starts. The native path should validate bundle shape, section digests, architecture policy, continuation class, resource policy, product-claim flags, and forbidden shortcuts.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/048/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/048/smoke.ts`; do not add a root `package.json` script.

## Goal

Make the verifier fail closed before any Node target process starts. The native path should validate bundle shape, section digests, architecture policy, continuation class, resource policy, product-claim flags, and forbidden shortcuts.

## Tasks

- [x] Extend the Zig/native verifier to validate required top-level bundle fields and per-section schema.
- [x] Validate canonical section digests and bundle digest natively.
- [x] Reject unsupported source/target architecture pairs and same-architecture shortcuts when cross-arch proof is required.
- [x] Reject product-support claims, broad Level 5 claims, runtime-profile routes, raw CPU copy, source fd reuse, source ISA emulation, sidecar replay, and metadata-only success.
- [x] Emit stable refusal codes and a deterministic verifier summary.
- [x] Prove the target materializer is never invoked for verifier refusals.

## Proof result

`pnpm exec tsx proof/048/smoke.ts` proves that the native verifier checks schema, required sections, digests, architecture, product claims, and forbidden shortcuts before any target starts.

## Validation

- [x] Run `pnpm exec tsx proof/048/smoke.ts`.
- [x] Assert valid bundles pass native verification.
- [x] Assert malformed schema, digest mismatch, unsupported architecture, product claim, and shortcut variants refuse natively.
- [x] Assert refused bundles stop before target materialization.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
