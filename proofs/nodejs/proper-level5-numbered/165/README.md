# Proof 165 — amd64 to arm64 VM E2E gate for declared subset

## TL;DR

amd64 to arm64 VM E2E gate for declared subset.

## Track objective

This proof contributes to making **100% of the declared experimental Node Level 5 subset** covered by contracts, gates, docs, or refusals. It does not claim broad Node support or product support.

## Translated continuation north star

The supported subset remains translated continuation only. Raw CPU restore, source-ISA emulation, source heap copying, and source fd copying remain refused.

## Tasks

- [x] Cover the positive declared-subset gate.
- [x] Cover the negative unsupported-neighbor gate.
- [x] Refuse broad product claims.
- [x] Record a checked summary.
- [x] Keep product support out of scope.
