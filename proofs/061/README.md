# Proof 061 — Thread classifier from live procfs capture

## TL;DR

Feed the classifier procfs files captured from a live proof process instead of hand-written thread rows.

## Track objective

Thread classification should consume captured `/proc/<pid>/task/*`-shaped files. This proof keeps the procfs capture proof-local and fail-closed.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Thread status, syscall, wait channel, PC, registers, and stack data are evidence for classification, not bytes to copy into the target.

## Tasks

- [x] Spawn a live proof process.
- [x] Capture procfs-shaped status/stat/syscall/wchan/fd files for it.
- [x] Classify idle event-loop wait from the captured files.
- [x] Refuse an unsafe captured running/blocking thread state.
- [x] Keep source CPU state evidence-only.

## Proof result

`pnpm exec tsx proofs/061/smoke.ts` proves procfs-shaped files captured for a live process drive the classifier and unsafe thread evidence refuses before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/061/smoke.ts`.
- [x] Assert captured idle epoll wait accepts.
- [x] Assert unsafe procfs evidence refuses.
