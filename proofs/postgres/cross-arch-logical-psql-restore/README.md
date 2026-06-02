# PostgreSQL / psql bidirectional cross-architecture logical restore proof

Status: `verified`

Track: `postgres`

Proof directory: `proofs/postgres/cross-arch-logical-psql-restore`

This proof verifies a narrow PostgreSQL/psql cross-architecture logical restore claim:

```text
PostgreSQL 15, clean quiesced database, target-native logical SQL restore:
arm64 -> amd64 verified
amd64 -> arm64 verified
```

## What this proves

The retained run used native PostgreSQL Docker hosts in both architectures:

- `arm64`: local Docker host (`aarch64 linux`)
- `amd64`: `root@192.168.0.8` (`x86_64 linux`)

For each direction it:

1. started a source PostgreSQL 15 container;
2. loaded schema/data/workload through `psql`;
3. checkpointed the database and confirmed zero active transactions;
4. created and retained a logical SQL artifact;
5. restored that logical SQL into a target-native PostgreSQL 15 container on the other architecture;
6. ran `psql` verifier queries on the target;
7. checked that source and target verifier outputs matched.

The retained target verifiers prove:

- `arm64 -> amd64` passed;
- `amd64 -> arm64` passed;
- target-native PostgreSQL execution was used;
- source and target `psql` verifier outputs matched in both directions;
- restored database had `rowCount = 4`;
- restored aggregate had `valueSum = 105`;
- retained logical SQL hashes matched route summaries;
- no source ISA emulation, sidecar, app hook, or metadata-only shortcut was accepted.

## Retained artifacts

```text
retained/postgres-cross-arch-logical-psql-restore-summary.json
retained/postgres-cross-arch-logical-psql-restore-gate-report.json
retained/product-command.txt
retained/arm64-to-amd64/postgres.logical.sql
retained/arm64-to-amd64/source-psql-transcript.txt
retained/arm64-to-amd64/target-psql-verifier.txt
retained/arm64-to-amd64/verifier.json
retained/amd64-to-arm64/postgres.logical.sql
retained/amd64-to-arm64/source-psql-transcript.txt
retained/amd64-to-arm64/target-psql-verifier.txt
retained/amd64-to-arm64/verifier.json
```

## What this does not prove

This is **not** a no-dump Machinen product snapshot/restore proof. It does not prove:

- `machinen snapshot` can capture PostgreSQL cross-architecture without an internal product capture path;
- `machinen restore` can restore PostgreSQL cross-architecture from a no-dump product bundle;
- physical PostgreSQL data-directory portability across ISA;
- active sessions, active transactions, dirty WAL, replication/failover state, native extensions, app hooks, sidecars, source ISA emulation, or metadata-only success.

The public portable PostgreSQL claim remains:

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

See `../real-cross-arch-e2e-gate/` for the still-required no-dump Machinen product gate.
