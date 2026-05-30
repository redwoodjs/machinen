# Proof 116 — Native full-thread-set verifier from procfs-shaped records

## TL;DR

Use a native verifier to check every captured thread is idle and waiting in a supported kernel wait channel.

## Track objective

Broad support needs whole-process safety. This proof moves thread-set checking into Zig and refuses unsafe threads before target start.

## Translated continuation north star

Thread records are evidence. Source stacks and registers are not copied to the target.

## Tasks

- [x] Add a native full-thread-set verifier.
- [x] Accept idle epoll/futex wait states.
- [x] Refuse running threads.
- [x] Refuse unsupported wait channels.
- [x] Keep product support out of scope.
