# Proof 107 — Closure environment recovery with multiple bindings

## TL;DR

Recover more than one captured closure binding and reconstruct the next target-native state.

## Track objective

Broad Node support needs closures with mixed values, not only one counter. This proof recovers a count, label, and boolean flag while refusing unsafe active-stack captures.

## Translated continuation north star

Captured closure context is evidence for target-native reconstruction. The target does not resume by copying a source stack.

## Tasks

- [x] Recover multiple closure bindings.
- [x] Gate the closure on supported Node/V8 identity.
- [x] Refuse active stack continuation.
- [x] Refuse incomplete environments.
- [x] Keep product support out of scope.
