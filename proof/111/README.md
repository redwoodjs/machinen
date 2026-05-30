# Proof 111 — Timer handle capture and target-native reconstruction

## TL;DR

Translate a captured libuv timer into a target-native timer descriptor.

## Track objective

Broad Node support needs event-loop resources, not just heap data. This proof covers idle timer state and refusal for active callbacks or source-handle copying.

## Translated continuation north star

The source timer handle is evidence. The target creates its own native timer instead of reusing a source handle.

## Tasks

- [x] Capture timer repeat and due time evidence.
- [x] Translate it into a target-native descriptor.
- [x] Refuse active callbacks.
- [x] Refuse source-handle copying.
- [x] Keep product support out of scope.
