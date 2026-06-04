# PostgreSQL / psql VM-state snapshot/restore proof

Status: `verified`

Track: `postgres`

Proof directory: `proofs/postgres/vmstate-snapshot-restore`

This proof verifies a narrow PostgreSQL/psql snapshot/restore claim:

```text
PostgreSQL 15, clean quiesced database, arm64 VM-state snapshot/restore: verified
```

## What this proves

The retained run booted a real PostgreSQL 15 service in a Machinen `arm64` VM, loaded schema/data/workload through `psql`, took a Machinen `vmstate` snapshot, restored it, and verified the target database with `psql`.

The retained target verifier proves:

- source and target `psql` verifier output matched;
- restored database had `rowCount = 4`;
- restored aggregate had `valueSum = 105`;
- restored payload/value arrays matched the source workload;
- snapshot was taken with no active PostgreSQL client transaction;
- a WAL checkpoint boundary was recorded;
- no source ISA emulation, sidecar, app hook, source-text replay, or metadata-only shortcut was accepted.

## Retained artifacts

```text
retained/postgres-vmstate-snapshot-restore-summary.json
retained/postgres-vmstate-snapshot-restore-gate-report.json
retained/source/product-command.txt
retained/source/source-psql-transcript.txt
retained/source/snapshot-meta.json
retained/target/product-command.txt
retained/target/restore.log
retained/target/target-psql-verifier.txt
retained/target/verifier.json
```

The raw `rootdisk.img`, `state.vmstate`, and provisioned rootfs are intentionally not committed because they are large binary run products. Their snapshot metadata and SHA256 references are retained in `source/snapshot-meta.json` and the gate report.

## What this does not prove

This is **not** a public cross-architecture PostgreSQL support claim. It does not prove:

- `amd64 -> arm64` PostgreSQL restore;
- `arm64 -> amd64` PostgreSQL restore;
- no-dump product-level portable PostgreSQL capture/restore;
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

See `../real-cross-arch-e2e-gate/` for the still-required bidirectional cross-architecture PostgreSQL gate.
