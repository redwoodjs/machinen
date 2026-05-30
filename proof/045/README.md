# Proof 045 — Product boundary claim audit

## TL;DR

Add a checked claim matrix for the translated-continuation proof track. Every row must say whether it is proof-only, harness-only, product-supported, or refused.

## Track objective

The actual goal is to prevent proof language from becoming accidental product claims. The matrix should make accepted proof rows, refused rows, and product support boundaries explicit and machine-checkable.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proof/045/`. Run the proof-local TypeScript smoke directly with `pnpm exec tsx proof/045/smoke.ts`; do not add a root `package.json` script.

## Goal

Emit and validate a proof-track claim matrix covering Proofs 028–044. The matrix should block broad Level 5/product claims unless an explicit product-supported implementation and validation exist.

## Tasks

- [x] Define claim statuses: proof-only, harness-only, product-supported, refused, and out-of-scope.
- [x] Add rows for heap graph translation, continuation descriptors, resource materialization, bundle integrity, refusal gauntlet, and cross-arch paths by auditing Proofs 027–044.
- [x] Assert proof-only rows do not claim product support.
- [x] Assert refused rows carry stable refusal codes through their proof summaries.
- [x] Assert no row claims broad Node Level 5 implementation.
- [x] Emit a checked summary consumed by later proofs.
- [x] Keep runtime-profile and raw CPU restore paths explicitly out of scope.

## Proof result

`pnpm exec tsx proof/045/smoke.ts` now audits Proofs 027–044 and proves:

- every audited proof keeps proof-only/harness boundary language;
- no checked summary claims product support or broad Node Level 5 implementation;
- forbidden shortcut claims stay blocked, including runtime profiles, raw cross-architecture CPU restore, source ISA emulation, sidecar replay, and metadata-only success.

## Validation

- [x] Run `pnpm exec tsx proof/045/smoke.ts`.
- [x] Assert every proof row has an explicit claim status.
- [x] Assert no proof-only/harness-only row claims product support.
- [x] Assert refused rows remain refused.
- [x] Assert no runtime-level profile, source ISA emulation, raw CPU copy, sidecar replay, or metadata-only success claim appears.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
