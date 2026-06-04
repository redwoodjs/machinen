# Postgres real cross-architecture E2E gate required

Status: `verified`

Track: `postgres`

This gate replaces the unvalidated Postgres percent raises. The scoped selected PostgreSQL no-dump product claim is now verified at `100 / 100 / 0` for clean quiesced PostgreSQL service capture/restore.

A narrower same-architecture PostgreSQL/psql VM-state proof is retained at `../vmstate-snapshot-restore/`. It verifies clean quiesced PostgreSQL restore inside an `arm64` Machinen VM, but it does not satisfy this bidirectional cross-architecture gate.

A native bidirectional PostgreSQL/psql logical restore proof is retained at `../cross-arch-logical-psql-restore/`. It verifies `arm64 -> amd64` and `amd64 -> arm64` target-native logical SQL restore, but it still does not satisfy this no-dump Machinen product gate.

Verified proof rows:

1. Real PostgreSQL `amd64 -> arm64` run.
2. Real PostgreSQL `arm64 -> amd64` run.
3. Product command captures without a user-supplied dump; the logical dump is internally produced and retained.
4. Product command restores into target-native PostgreSQL and runs `psql` verification without `--target-verifier-output`.
5. Retained row proofs for psql query workload, schema/data query, role/permission, `pg_isready`, `psql`, and `createdb`/`dropdb` commands.
6. Refusal boundaries for active sessions, active transactions, dirty WAL, physical data-dir copy, replication/failover, source-ISA emulation, sidecars, app hooks, and metadata-only success remain explicit.

Retained no-shortcut blocker report:

```text
proofs/postgres/real-cross-arch-e2e-gate/retained/postgres-real-cross-arch-e2e-gate-report.json
proofs/postgres/real-cross-arch-e2e-gate/retained/<direction>/row-proofs/*/row-proof.json
```

That report is now claim-bearing for the selected clean quiesced PostgreSQL service scope. It still proves logical fixtures, user-supplied dumps, physical data-dir copies, source ISA emulation, sidecars, app hooks, metadata-only success, and arbitrary process restore cannot broaden the claim.

The public scoped PostgreSQL claim is:

```json
{
  "productSupport": 100,
  "broadSupport": 100,
  "arbitraryProcessCrossArchRestore": 0
}
```
