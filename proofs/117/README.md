# Proof 117 — Worker-thread refusal/support classification

## TL;DR

Classify main, platform, and worker threads and refuse unsupported worker-thread state.

## Track objective

Broad Node support needs clear thread boundaries. This proof records that worker threads and SharedArrayBuffer state remain unsupported until a safer translation path exists.

## Translated continuation north star

Thread classifications are evidence. Source stacks and concurrent worker state are not copied.

## Tasks

- [x] Classify main/platform/worker threads.
- [x] Accept idle main/platform-only state.
- [x] Refuse worker threads.
- [x] Refuse SharedArrayBuffer state.
- [x] Keep product support out of scope.
