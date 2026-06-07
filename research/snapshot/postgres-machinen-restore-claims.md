# PostgreSQL cross-architecture restore claims

> **Status: proof-audit.** This is proof evidence only unless the product claim registry advertises a product route. Use `pnpm run proof-postgres-cross-arch-restore` only with this status in mind.

Goal 43 proves a narrow PostgreSQL portable restore envelope using real
PostgreSQL on both architectures.

## Validated command

```bash
pnpm run proof-postgres-cross-arch-restore -- --keep --work-dir /tmp/goal43-postgres-cross-arch
```

By default the smoke uses the local MacBook Docker host as the arm64 source or
target (`--arm-host local`) and the local Proxmox server as the amd64 source or
target (`--amd-host root@192.168.0.8`). It runs both routes:

- arm64 PostgreSQL -> amd64 PostgreSQL;
- amd64 PostgreSQL -> arm64 PostgreSQL.

## How the restore works

The supported portable unit is a clean logical PostgreSQL descriptor/dump, not a
raw PostgreSQL physical data directory and not a raw whole-VM `.vmstate` image.
The proof:

1. starts target-native PostgreSQL 15 on the source architecture;
2. applies the audited SQL fixture in `scripts/fixtures/postgres-machinen/`;
3. reaches a clean checkpointed state with no active client transaction;
4. captures a target-neutral logical dump with `pg_dump`;
5. starts target-native PostgreSQL 15 on the destination architecture;
6. restores the dump;
7. verifies that source and target logical verifier fingerprints match exactly.

## Supported subset

Supported:

- PostgreSQL 15 clean/quiesced logical database state;
- bidirectional `arm64 <-> amd64` restore;
- audited local SQL fixture with schema, seed data, workload, and verifier;
- create/insert/update/query workload;
- explicit checkpoint/WAL boundary before capture;
- no active client transaction at capture time;
- no active client session that must survive restore;
- target-native PostgreSQL execution on the destination architecture;
- source and target logical verifier output must match;
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
- `postgres-physical-data-dir-cross-arch-unsupported`

## Provenance recorded

The checked summary records:

- source and target host architectures;
- PostgreSQL source and target versions;
- container image tag;
- init/workload/verifier SQL digests;
- checkpoint LSN;
- logical dump digest and byte size;
- source and target verifier output digests;
- bidirectional route fingerprints;
- shortcut guard results.

## Matrix presets

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset postgres-machinen \
  --check-summary-dir research/snapshot/checked-summaries/postgres-machinen \
  --json
```

Focused presets:

- `postgres-machinen-positive`
- `postgres-machinen-refusal`

The older same-architecture Machinen `vmstate` smoke remains only a local service
sanity check. It is not the PostgreSQL portable support claim.
