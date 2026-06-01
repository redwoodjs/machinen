# Postgres real cross-architecture E2E gate required

Status: `not-started`

Track: `postgres`

This gate replaces the unvalidated Postgres percent raises. No public Postgres no-dump `machinen snapshot` / `machinen restore` claim is allowed until the real E2E artifacts exist.

Required proof rows:

1. Real PostgreSQL `amd64 -> arm64` run.
2. Real PostgreSQL `arm64 -> amd64` run.
3. Product command captures without a user-supplied dump; any logical dump is internally produced and retained.
4. Refusal audit for active sessions, active transactions, dirty WAL, physical data-dir copy, replication/failover, source-ISA emulation, sidecars, app hooks, and metadata-only success.

Until those pass, Postgres stays `0 / 0 / 0` for public snapshot/restore claims.
