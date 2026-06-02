# Postgres real cross-architecture E2E gate required

Status: `blocked-by-missing-real-e2e-artifacts`

Track: `postgres`

This gate replaces the unvalidated Postgres percent raises. No public Postgres no-dump cross-architecture `machinen snapshot` / `machinen restore` claim is allowed until the real E2E artifacts exist.

A narrower same-architecture PostgreSQL/psql VM-state proof is retained at `../vmstate-snapshot-restore/`. It verifies clean quiesced PostgreSQL restore inside an `arm64` Machinen VM, but it does not satisfy this bidirectional cross-architecture gate.

A native bidirectional PostgreSQL/psql logical restore proof is retained at `../cross-arch-logical-psql-restore/`. It verifies `arm64 -> amd64` and `amd64 -> arm64` target-native logical SQL restore, but it still does not satisfy this no-dump Machinen product gate.

Required proof rows:

1. Real PostgreSQL `amd64 -> arm64` run.
2. Real PostgreSQL `arm64 -> amd64` run.
3. Product command captures without a user-supplied dump; any logical dump is internally produced and retained.
4. Refusal audit for active sessions, active transactions, dirty WAL, physical data-dir copy, replication/failover, source-ISA emulation, sidecars, app hooks, and metadata-only success.

Retained no-shortcut blocker report:

```text
proofs/postgres/real-cross-arch-e2e-gate/retained/postgres-real-cross-arch-e2e-gate-report.json
```

That report is claim-protective only: it proves PostgreSQL stays `0 / 0 / 0` and that logical fixtures, user-supplied dumps, physical data-dir copies, source ISA emulation, sidecars, app hooks, and metadata-only success cannot raise a public PostgreSQL claim.

Until the real bidirectional E2E rows pass, PostgreSQL stays `0 / 0 / 0` for public snapshot/restore claims.
