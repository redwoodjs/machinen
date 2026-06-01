# Proof 101 — Native verifier consumes capture-derived thread and resource evidence

## TL;DR

Feed the native process/resource verifier from Zig guest-capture records instead of hand-written verifier input.

## Track objective

This makes whole-process thread/resource verification less artificial. Evidence comes from capture records and is checked natively before any target start.

## Translated continuation north star

Thread and resource records are evidence for translated continuation. Source fds, handles, stacks, and registers are not copied into the target.

## Tasks

- [x] Read thread and fd/resource evidence from Zig guest-capture records.
- [x] Build native verifier input from captured records.
- [x] Verify safe thread/resource state natively.
- [x] Refuse unsafe thread, unsafe resource, and source-handle copy rows.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proofs/101/smoke.ts` proves the native process/resource verifier consumes capture-derived evidence and refuses unsafe rows before target start.

## Validation

- [x] Run `pnpm exec tsx proofs/101/smoke.ts`.
- [x] Assert capture-derived thread/resource evidence feeds native verification.
- [x] Assert unsafe rows refuse before target start.
