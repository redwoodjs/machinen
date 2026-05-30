# Proof 124 — CI-style repeatability suite with artifact diffing

## TL;DR

Repeat representative E2E proofs twice and compare normalized artifact digests.

## Track objective

Broad support needs automation confidence. This proof creates a CI-shaped repeatability lane without adding a root script.

## Translated continuation north star

Repeatability covers target-native reconstruction and cross-arch lanes. It still remains proof-only.

## Tasks

- [x] Repeat the HTTP/timer E2E proof.
- [x] Repeat the bidirectional cross-arch proof.
- [x] Normalize and digest artifacts.
- [x] Assert digests are stable.
- [x] Keep product support out of scope.
