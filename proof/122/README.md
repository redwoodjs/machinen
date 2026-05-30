# Proof 122 — Product-shaped restore CLI behind experimental flag

## TL;DR

Add a proof-only restore CLI shape that consumes a capture manifest and requires translated continuation.

## Track objective

Broad support needs a restore command shape, but raw CPU restore must be refused. This proof keeps the boundary experimental and proof-only.

## Translated continuation north star

Cross-architecture restore must use translated continuation. Raw registers, PC, stack, and source CPU state are not restored.

## Tasks

- [x] Add proof-only experimental restore CLI harness.
- [x] Consume a proof-only capture manifest.
- [x] Require explicit flags.
- [x] Refuse raw CPU restore.
- [x] Keep product support out of scope.
