# Proof 031 — Full process image inventory

## TL;DR

Move beyond selected useful memory fragments. Capture a full inventory of the Node process image: mappings, bytes policy, thread state, syscall/register evidence where available, stack hints, signal state, fd table, and kernel resources. This is still a proof bundle, not product support.

## Track objective

The actual goal is to make the source-state bundle honest about the whole process image while still restoring only supported semantic state. Every captured mapping, thread, and fd should be classified as translated, recreated, copied as evidence, or refused. A complete inventory is evidence for future restore work; it is not a claim that the full process image is restorable.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Proof folder

All implementation notes, fixtures, and smoke tests for this proof should live under `proofs/by-id/031/`. The proof smoke test may be written in TypeScript, for example `proofs/by-id/031/smoke.ts`, with an optional `proofs/by-id/031/smoke.sh` compatibility wrapper. Do not add root `package.json` scripts for this proof; run proof-local TypeScript smokes directly with `pnpm exec tsx proofs/by-id/031/smoke.ts`.

## Goal

Produce a source-state bundle that is rich enough to explain every source thread and memory mapping, even when the target still reconstructs only a narrow Node counter. The proof should make the unknown parts explicit as copied, recreated, translated, or refused.

## Tasks

- [x] Extend the Zig guest capture tool to enumerate every process memory mapping.
- [x] Record per-mapping policy: captured bytes, recreated target mapping, file-backed identity, guard/special mapping, or refused.
- [x] Capture per-thread status, stat, syscall/register evidence where available, and stack-range policy hints.
- [x] Capture signal masks, pending signals, process credentials, auxv, cmdline, environ, cwd/root/exe links, and namespace hints.
- [x] Capture fd table with resource classes: regular file/device, pipe, socket, eventfd, timerfd, epoll, anon inode, unknown.
- [x] Emit a portable process-image inventory JSON with stable refusal codes for unknown resources.
- [x] Keep the target reconstruction narrow and target-native; do not claim raw full-process restore.

## Proof result

`pnpm exec tsx proofs/by-id/031/smoke.ts` now proves:

- every `/proc/<pid>/maps` row has a policy in `process-image-inventory.json`;
- every `/proc/<pid>/task/*` thread has status/stat/syscall evidence or a stable refusal code;
- every fd has a resource class and an inventory policy;
- process links, namespace hints, auxv, cmdline, environ, signal masks, credentials, TCP tables, and fd tables are part of the source-state bundle;
- idle target-native continuation still recovers the raw V8 context Smi counter and returns `{ "count": 3 }`;
- active in-flight HTTP request state still refuses;
- the proof does not claim raw full-process restore or product support.

## Validation

- [x] Run `pnpm exec tsx proofs/by-id/031/smoke.ts`.
- [x] Assert every `/proc/<pid>/maps` row has a mapping policy in the inventory.
- [x] Assert every `/proc/<pid>/task/*` thread has a thread-state row.
- [x] Assert every fd has a resource classification or a refusal.
- [x] Assert idle target-native continuation still returns `{count:3}`.
- [x] Assert no product support claim, no source ISA emulation, no app export/import, no checkpoint API, and no metadata-only success.
- [x] Run `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest, and `pnpm exec fallow audit --changed-since origin/main`.
