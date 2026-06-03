# Selected arbitrary Linux process behavior E2E

Status: `verified`

Scope: `selected-arbitrary-linux-process-seed-v1`

This is a retained proof-only behavior E2E gate. It composes process metadata/state checks with the selected resource seed proofs and keeps the public arbitrary Linux process cross-architecture restore claim at `0`.

## Verified behavior

- argv/env/cwd target verifier matched the captured hashes
- static/data/heap payload target verifier matched the captured hash
- regular-file FD proof verified captured offset, read continuation, and target offset advance
- simple pipe FD proof verified buffered bytes, endpoint direction, and EOF
- idle epoll/TCP proof verified no ready events and no accepted streams

## Refused boundaries

- threads
- active syscalls
- JIT/generated executable pages
- futex owners/waiters
- active sockets and active epoll readiness
- device mmap / opaque device state
- process trees
- arbitrary unknown Linux process state

## Claim effect

No public claim change:

```json
{
  "productSupport": null,
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0
}
```

Product-path artifacts are not required for this proof-only gate, and `productSupportRowsAdded` is `0`.

## Retained artifact

- `retained/selected-arbitrary-process-behavior-e2e-report.json`
