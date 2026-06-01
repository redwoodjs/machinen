# Arbitrary process Level 5 seed matrix

This is the first arbitrary-process claim track artifact. It does **not** raise arbitrary process cross-architecture restore above `0%`.

Current claim boundary:

```json
{
  "nodeProductSupportClaimed": 100,
  "broadNodeProductSupportClaimed": 100,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

Candidate future boundary:

```json
{
  "arbitraryProcessCrossArchRestoreClaimed": 1,
  "claimChangeAllowed": false
}
```

## CLI

```sh
machinen node-level5 arbitrary-process-seed --json
machinen node-level5 arbitrary-process-seed --out ./arbitrary-process-seed --json
```

## Seed rows

The matrix starts with tiny target-native reconstruction candidates:

- single-thread idle native counter;
- argv/env/cwd reconstruction;
- regular file descriptor translation;
- simple pipe descriptor translation;
- static/data/heap byte materialization;
- selected syscall/resource boundary descriptors;
- ping/ICMP socket resource reconstruction using the existing Level 4 ping evidence.

These rows are seed candidates only. They are not a public arbitrary-process support claim.

The first row with an attached verifier is `native-regular-file-fd`; see `../../proofs/arbitrary-linux-binaries/0-seed-1-locked/regular-file-fd-proof.md`. That proof verifies regular file descriptor target-native reconstruction while keeping arbitrary-process support at `0%`.

## Refusal rows

The matrix keeps unsafe process state refused:

- threads;
- JIT code;
- futex-owned locks;
- live sockets;
- device mmap;
- active epoll.

The ping row is still a seed candidate for the arbitrary-process track. It reuses proven ping socket reconstruction evidence as one native resource row, not as proof of arbitrary process restore.

## Required rules

Arbitrary-process support must be based on captured source process state and target-native reconstruction/translation. The seed matrix forbids raw CPU restore, source ISA emulation, app checkpoint hooks, and metadata-only success.
