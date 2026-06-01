# Arbitrary process 0% / candidate 1% locked

Status: `partial-proof`

Track: `arbitrary-process`

Proof directory: `proof/claims/arbitrary-process-0-seed-1-locked`

Scope: Captured process-state translation plus target-native reconstruction seeds.

Promotion effect: No public claim change until a dedicated arbitrary-process claim-ready gate passes.

## Claim numbers

```json
{
  "productSupport": null,
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0,
  "candidateArbitraryProcessCrossArchRestore": 1
}
```

## Proofs

| Proof                           | Category        | Status          | Artifact                                    | Proves                                                                             | Claim use                                           | Next                                                     |
| ------------------------------- | --------------- | --------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `arbitrary-process-seed-matrix` | seed matrix     | `passed`        | `arbitrary-process-level5-seed-matrix.json` | 14-row seed/refusal/not-proven matrix with claim locked at 0                       | defines proof backlog and unsafe refusals           | Add claim-ready gate.                                    |
| `regular-file-fd-proof`         | file descriptor | `verified-seed` | `regular-file-fd-proof-report.json`         | Target-native reopen preserves captured file offset and read continuation          | one verified arbitrary-process seed; no claim raise | Use as pattern for simple pipe FD proof.                 |
| `unsafe-process-boundaries`     | refusals        | `refused`       | `arbitrary-process-level5-seed-matrix.md`   | threads, JIT, futex owners, live sockets, device mmap, active epoll remain refused | prevents overclaiming                               | Only reduce boundaries with retained verifier artifacts. |

## Local proof notes

- [Regular file FD proof](./regular-file-fd-proof.md)
