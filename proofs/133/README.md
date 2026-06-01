# Proof 133 — TCP listener reconstruction from real socket/libuv handle pairing

## TL;DR

TCP listener reconstruction from real socket/libuv handle pairing.

## Track objective

This proof is part of the push from roughly 50% to 80% Broad Node Level 5 readiness. It remains proof-only and does not claim product support.

## Translated continuation north star

Captured source state is evidence for translation. The target reconstructs native Node state; it does not copy source heap bytes, fds, stacks, registers, or CPU state.

## Tasks

- [x] Add the proof-local smoke harness.
- [x] Record accepted evidence gates.
- [x] Refuse missing evidence before target start.
- [x] Refuse raw source-state copying.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proofs/133/smoke.ts` records the proof summary and boundary refusals.
