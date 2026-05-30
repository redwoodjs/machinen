# Proof 121 — Product-shaped capture CLI behind experimental flag

## TL;DR

Add a proof-only capture CLI shape that requires explicit experimental flags.

## Track objective

Broad support needs a command shape, but this must not claim product support. This proof writes a capture manifest only under proof-only flags.

## Translated continuation north star

The capture command emits evidence records for translation. It is not a supported public restore path.

## Tasks

- [x] Add proof-only experimental capture CLI harness.
- [x] Require explicit flags.
- [x] Write a capture manifest.
- [x] Refuse product-support claim attempts.
- [x] Keep product support out of scope.
