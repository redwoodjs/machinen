# Proof 112 — TCP listener capture and target-native reconstruction

## TL;DR

Translate an idle TCP listener into a target-native listener and refuse active or copied-fd paths.

## Track objective

Broad Node support needs network listeners. This proof covers a safe listener shape and nearby unsafe states.

## Translated continuation north star

The source socket is evidence. The target creates its own native listener instead of copying the source fd.

## Tasks

- [x] Capture listener host, port, and state evidence.
- [x] Reconstruct a target-native listener.
- [x] Refuse active accepted queues.
- [x] Refuse source-fd copying.
- [x] Keep product support out of scope.
