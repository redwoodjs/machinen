# PostgreSQL Machinen snapshot/restore claims

Goal 43 proves a narrow PostgreSQL support envelope for a real PostgreSQL
service running inside a Machinen microVM.

## Validated command

```bash
pnpm smoke-postgres-machinen-restore -- --keep --work-dir /tmp/goal43-postgres
```

The smoke builds or reuses a local PostgreSQL image, boots it in Machinen, starts
PostgreSQL inside the guest, runs the audited SQL fixture, snapshots the VM with
the `vmstate` engine, restores it, and verifies the same logical database state
on the restored target.

## Supported subset

Supported:

- PostgreSQL 15 inside an arm64 Machinen VM;
- audited local SQL fixture in `scripts/fixtures/postgres-machinen/`;
- create/insert/update/query workload;
- explicit `CHECKPOINT`, WAL switch, and `sync` before snapshot;
- no active client transaction at snapshot time;
- no active client session that must survive restore;
- whole-VM `vmstate` restore with target-native PostgreSQL verification;
- source and target verifier output must match exactly;
- `migrationCompleted=true` only after target verification passes.

## Refused unsafe neighbors

The following states stay fail-closed with `migrationCompleted=false`:

- `postgres-active-transaction-unsupported`
- `postgres-active-session-unsupported`
- `postgres-dirty-wal-boundary-unsupported`
- `postgres-unsynced-data-directory-unsupported`
- `postgres-replication-slot-state-unsupported`
- `postgres-streaming-replication-unsupported`
- `postgres-extension-native-state-unsupported`
- `postgres-host-mounted-data-dir-ambiguous`

## Provenance recorded

The checked summary records:

- PostgreSQL version;
- guest architecture;
- image digest;
- init/workload/verifier SQL digests;
- WAL/checkpoint LSN;
- data directory manifest digest;
- target verifier output digest;
- shortcut guard results.

## Matrix presets

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset postgres-machinen \
  --check-summary-dir docs/snapshot/checked-summaries/postgres-machinen \
  --json
```

Focused presets:

- `postgres-machinen-positive`
- `postgres-machinen-refusal`
