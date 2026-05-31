# Proof 062 — Resource descriptors from live kernel evidence

## TL;DR

Emit resource descriptors from live listener evidence, fd links, and proc-net-shaped files.

## Track objective

Resource descriptors should come from kernel evidence, not hand-authored descriptors. Supported resources are rebuilt as fresh target-native handles; unsafe live states refuse.

## Translated continuation north star

Kernel resources are evidence for target-native reconstruction. Source fds and kernel objects must not be copied into the target.

## Tasks

- [x] Capture live listener/kernel-shaped evidence.
- [x] Emit listener, timer, eventfd, and pipe descriptors from that evidence.
- [x] Materialize fresh target-native resource state.
- [x] Refuse connected/unread-byte state before target start.
- [x] Prove source fds are not reused.

## Proof result

`pnpm exec tsx proof/062/smoke.ts` proves live kernel-shaped evidence emits four resource descriptors and unsafe unread-byte state refuses.

## Validation

- [x] Run `pnpm exec tsx proof/062/smoke.ts`.
- [x] Assert descriptors come from kernel evidence.
- [x] Assert source fds are not reused.
