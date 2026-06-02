# Postgres real cross-architecture E2E gate required

Status: `blocked-by-missing-real-e2e-artifacts`

Track: `postgres`

This gate replaces the unvalidated Postgres percent raises. No public Postgres no-dump `machinen snapshot` / `machinen restore` claim is allowed until the real E2E artifacts exist.

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
