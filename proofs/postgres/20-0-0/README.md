# Postgres clean logical descriptor fixture / no public claim

Status: `partial-proof`

Track: `postgres`

Proof directory: `proofs/postgres/20-0-0`

This folder is retained fixture evidence for the logical PostgreSQL descriptor path. It is **not** a public Postgres no-dump `machinen snapshot` / `machinen restore` claim.

## Public claim numbers

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## What this proves

The retained report in `retained/postgres-claim-ladder-report.json` exercises fixture-level logical dump descriptors, restore summaries, verifier-output matching, and unsafe-state refusals.

## What this does not prove

- no-dump product capture of a real PostgreSQL service;
- real PostgreSQL amd64 -> arm64 E2E restore;
- real PostgreSQL arm64 -> amd64 E2E restore;
- app workload behavior against a restored target service;
- broad service/workload support;
- arbitrary Linux process restore.

See `../real-cross-arch-e2e-gate/` for the required gate before any public Postgres percentage claim.
