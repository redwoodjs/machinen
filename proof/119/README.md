# Proof 119 — Native resource verifier consumes kernel fd/socket records

## TL;DR

Verify kernel-shaped fd/resource records with a native Zig checker.

## Track objective

Broad support needs native resource checks over kernel evidence. This proof covers listener, timer, pipe, and readonly-file records.

## Translated continuation north star

Kernel records are evidence. Target resources are recreated natively and source handles are never copied.

## Tasks

- [x] Add a native kernel resource verifier.
- [x] Accept safe listener/timer/pipe/file records.
- [x] Refuse unsafe resource state.
- [x] Refuse source-handle copying and unknown resource kinds.
- [x] Keep product support out of scope.
