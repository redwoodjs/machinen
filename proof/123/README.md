# Proof 123 — Bidirectional arm64→amd64 and amd64→arm64 E2E lane

## TL;DR

Run both cross-architecture directions in one proof-local E2E lane.

## Track objective

Broad support needs confidence in both directions. This proof records arm64→amd64 and amd64→arm64 target-native lanes without source-ISA emulation.

## Translated continuation north star

Both directions use translated state, not raw CPU restore or source instruction emulation.

## Tasks

- [x] Run an arm64→amd64 target-native lane.
- [x] Run an amd64→arm64 target-native lane.
- [x] Assert both return the next state.
- [x] Refuse source-ISA emulation as a shortcut.
- [x] Keep product support out of scope.
