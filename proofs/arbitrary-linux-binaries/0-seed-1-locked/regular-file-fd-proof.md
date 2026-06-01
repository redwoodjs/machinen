# Arbitrary process Level 5 regular file FD proof

This proof verifies the first arbitrary-process seed row that moves beyond a
matrix-only candidate: `native-regular-file-fd`.

It is still **not** a public arbitrary Linux process restore claim. The current
arbitrary-process cross-architecture restore claim remains `0%`.

## What is proven

The proof builds a source capture record for one idle, single-thread native
process resource:

- fd `3` is a regular file;
- the captured fd offset points into the file;
- the target reconstructs the fd by reopening the target-native file path;
- the target verifier reads from the captured offset and checks the expected
  bytes;
- the verifier confirms the target offset advances after the read.

The retained artifacts are:

- `source-capture.json`;
- `target-reconstruction-plan.json`;
- `target-verifier.json`;
- `regular-file-fd-proof-report.json`.

## What is not used

The proof explicitly records that it does not use:

- raw CPU/register restore;
- source ISA emulation;
- app checkpoint hooks;
- metadata-only success.

## Run

```sh
bash scripts/smoke/arbitrary-process-level5-regular-file-fd-proof.sh
```

Or write artifacts directly:

```sh
pnpm exec tsx proofs/arbitrary-linux-binaries/scripts/arbitrary-process-level5-regular-file-fd-proof.ts --out ./regular-file-fd-proof --json
```

## Claim boundary

The proof reports:

```txt
currentArbitraryProcessCrossArchRestoreClaimed: 0
candidateArbitraryProcessCrossArchRestoreClaimed: 1
claimChangeAllowed: false
arbitraryProcessClaimed: false
```

A separate arbitrary-process claim-ready gate must pass before this can affect
any product support percentage.
