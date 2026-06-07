# Real resource state batch ladder

This lane batches ten resource-state axes for cross-architecture target-native
descriptor reconstruction.

Accepted groups:

- regular file read and append offsets
- owned empty, queued, and EOF pipe descriptors
- blocked signal mask and process-group signal delivery
- sleep remaining-time and interval timer ticks
- cwd and relative-path descriptors
- environment, argv, and cwd+env+argv descriptors
- read-only and writable file-backed mmap descriptors
- single-thread boundary
- PID-not-preserved proof and pgrp/session descriptor
- terminal raw mode and alternate-screen descriptors

Refused groups:

- deleted-but-open file
- symlink target ambiguity
- external pipe fd
- pending signal
- readable timerfd
- deleted cwd
- anonymous mmap unless declared
- multi-thread process
- thread blocked in syscall
- orphan child risk
- terminal window-size mismatch

The lane proves same-architecture behavior plus bidirectional amd64 ↔ arm64
source/target roles for every case. It does not claim arbitrary process restore,
raw VM replay, source-ISA emulation, raw stack/heap/register reconstruction, or
kernel object identity preservation.

Run:

```sh
portability/research/real-resource-state-batch-ladder/verify.sh
```

The retained result is `proved-with-refusals` in `retained/report.json`.
