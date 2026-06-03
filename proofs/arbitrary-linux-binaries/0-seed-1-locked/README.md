# Arbitrary process 0% / candidate 1% locked

Status: `partial-proof`

Track: `arbitrary-process`

Proof directory: `proofs/arbitrary-linux-binaries/0-seed-1-locked`

Scope: Captured process-state translation plus target-native reconstruction seeds.

Promotion effect: No public claim change. The selected seed gate is proof-only, does not require product-path artifacts, and keeps arbitrary Linux process restore at `0`.

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

| Proof                                     | Category                      | Status          | Artifact                                                                                        | Proves                                                                                                                     | Claim use                                              | Next                                                                             |
| ----------------------------------------- | ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `arbitrary-process-seed-matrix`           | seed matrix                   | `passed`        | `arbitrary-process-level5-seed-matrix.json`                                                     | 14-row seed/refusal/not-proven matrix with claim locked at 0                                                               | defines proof backlog and unsafe refusals              | Keep public claim changes separate from seed proofs.                             |
| `arbitrary-process-claim-ready-gate`      | claim gate                    | `passed`        | `arbitrary-process-claim-ready-report.json`                                                     | claimChangeAllowed can only become true through the dedicated claim-ready gate                                             | keeps public arbitrary-process claim at 0              | Candidate 1% is authorized only by separate decision.                            |
| `regular-file-fd-proof`                   | file descriptor               | `verified-seed` | `regular-file-fd-proof-report.json`                                                             | Target-native reopen preserves captured file offset and read continuation                                                  | one verified arbitrary-process seed; no claim raise    | Covered by the accepted claim-ready gate.                                        |
| `simple-pipe-fd-proof`                    | file descriptor               | `verified-seed` | `simple-pipe-fd-proof-report.json`                                                              | Target-native simple pipe reconstruction preserves endpoint direction and EOF                                              | second verified arbitrary-process seed                 | Covered by the accepted claim-ready gate.                                        |
| `idle-epoll-tcp-proof`                    | kernel resource               | `verified-seed` | `idle-resource-proof-report.json`                                                               | Idle epoll and idle TCP listener reconstruction has no ready events/streams                                                | third verified seed; unlocks the gate only             | Keep public claim changes in a separate PR.                                      |
| `unsafe-process-boundaries`               | refusals                      | `refused`       | `arbitrary-process-level5-seed-matrix.md`                                                       | threads, JIT, futex owners, live sockets, device mmap, active epoll remain refused                                         | prevents overclaiming                                  | Only reduce boundaries with retained verifier artifacts.                         |
| `selected-arbitrary-process-seed-gate`    | selected process seed gate    | `verified`      | `../selected-process-seed/retained/selected-arbitrary-process-seed-gate-report.json`            | selected-arbitrary-linux-process-seed-v1 has 3 proof-only seed rows and 6 refusals                                         | candidate-only selected seed evidence; claim remains 0 | Add broader retained product-path support only in a separate claim-change path.  |
| `selected-arbitrary-process-behavior-e2e` | selected process behavior e2e | `verified`      | `../selected-process-behavior-e2e/retained/selected-arbitrary-process-behavior-e2e-report.json` | selected seed behavior checks pass for argv/env/cwd, static/data/heap, regular-file FD, simple pipe FD, and idle epoll/TCP | proof-only selected behavior evidence; claim remains 0 | Broaden only with retained product-path support and uncontrolled-state coverage. |

## Next proof matrix rows

Rows `arbitrary/009` through `arbitrary/018` are retained in `../selected-process-next-proof-matrix/retained/selected-arbitrary-process-next-proof-matrix-report.json`. They are proof-only, refusal, or claim-locked rows and do not change the public arbitrary Linux process restore claim.

## Proof/classification phase ladder

The retained phase ladder lives in `../100-phase-ladder/retained/arbitrary-process-100-phase-ladder-report.json`. It defines phases 1–7 with product support out of scope and keeps the public arbitrary Linux process restore claim at `0`.

## Controlled process corpus

`arbitrary/019` lives in `../controlled-process-corpus/retained/controlled-process-corpus-matrix-report.json`. It verifies 10/10 controlled process proof rows with 6 supported-proof rows, 4 refused rows, and 0 unknown rows. Product support remains out of scope and arbitrary Linux process restore remains `0`.

## Complete declared-state classification matrix

Rows `arbitrary/020` through `arbitrary/039` live in `../complete-classification-matrix/retained/arbitrary-process-complete-classification-matrix-report.json`. They prove/classify 20/20 declared arbitrary-process state classes with 20 retained row proof artifacts: 6 target-native reconstruction proofs, 14 stable refusal proofs, and 0 unknown rows. Product support remains out of scope and arbitrary Linux process restore remains `0`.

## Local proof notes

- [Regular file FD proof](./regular-file-fd-proof.md)
