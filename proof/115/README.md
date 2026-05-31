# Proof 115 — E2E HTTP/timer app resumes next observable behavior

## TL;DR

Compose HTTP listener and timer descriptors into a target-native Node app that returns the next observable state.

## Track objective

Broad Node support needs common event-loop behavior. This proof exercises a listener plus timer-shaped state in one E2E target path.

## Translated continuation north star

The target rebuilds native HTTP and timer behavior from descriptors. It does not copy source sockets, timers, stacks, or callbacks.

## Tasks

- [x] Verify idle listener and timer descriptors.
- [x] Start a target-native HTTP server.
- [x] Return next observable count/timer state.
- [x] Refuse active listener and active timer neighbors.
- [x] Keep product support out of scope.
