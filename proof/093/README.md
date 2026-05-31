# Proof 093 — Native whole-process thread/resource verifier

## TL;DR

Move whole-process thread and resource safety checks into a native verifier with typed refusal reports.

## Track objective

This targets the third remaining product blocker: native verification of all stopped threads and resources. The proof remains narrow but refuses unsafe thread/resource states before target start.

## Translated continuation north star

Thread and resource evidence must be classified and verified before target-native reconstruction. Source stacks, registers, fds, and handles remain evidence only.

## Tasks

- [x] Add a native Zig process/resource verifier.
- [x] Verify the whole thread set is safe.
- [x] Verify resource descriptors are safe.
- [x] Refuse source-handle copying and missing continuation descriptors.
- [x] Emit typed refusal reports with section and field.

## Proof result

`pnpm exec tsx proof/093/smoke.ts` proves native verification accepts the safe whole-process evidence and refuses unsafe threads, unsafe resources, source handle copying, and missing continuation descriptors before target start.

## Validation

- [x] Run `pnpm exec tsx proof/093/smoke.ts`.
- [x] Assert native verifier checks thread/resource evidence.
- [x] Assert typed refusals include section and field.
