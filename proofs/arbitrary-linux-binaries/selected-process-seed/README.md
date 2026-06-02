# Selected arbitrary Linux process seed gate

Status: `verified`

Scope: `selected-arbitrary-linux-process-seed-v1`

This gate records a proof-only selected arbitrary-process seed. It accepts three retained seed proofs and keeps the public arbitrary Linux process cross-architecture restore claim at `0`.

## What is verified

- regular-file FD seed
- simple-pipe FD seed
- idle epoll/TCP seed
- retained refusal rows for threads, JIT code, futex owners, live sockets/active epoll, device mmap, and arbitrary unknown Linux process state

## Claim effect

No public claim change:

```json
{
  "productSupport": null,
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0
}
```

The report is candidate-only evidence for `selected-arbitrary-linux-process-seed-v1`. Product-path artifacts are intentionally not required here, so `productSupportRowsAdded` remains `0` and `publicClaimAllowed` remains `false`.

## Retained artifact

- `retained/selected-arbitrary-process-seed-gate-report.json`
