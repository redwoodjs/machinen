# Postgres clean logical 40 / 0 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/40-0-0`

Scope: Clean, idle logical Postgres reconstruction with schema-shape, version, and workload-mix retained verifier artifacts. Active sessions, active transactions, dirty WAL, and physical data-dir cross-ISA copy remain refused.

Promotion effect: Raises Postgres product support to 40%; broad service/workload support and arbitrary Linux process restore stay 0%.

## Claim numbers

```json
{
  "productSupport": 40,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

This claim applies the accepted gate report retained at:

- `../20-0-0/retained/postgres-clean-logical-20-claim-ready-report.json`
- `../20-0-0/retained/postgres-clean-logical-20-claim-ready/`

The gate retains bidirectional arm64/amd64 fixtures for:

- schema shapes: primary key, foreign-key join, index/sequence;
- PostgreSQL versions: 14, 15, 16;
- clean workload mixes: read-only lookup, committed write batch, aggregate query.

Every row retains a manifest, logical dump, restore summary, source verifier, target verifier, and hashes. This is still clean logical reconstruction only.

## Proof impact rows

| Proof                                     | Category            | Status   | Product / broad / arbitrary-process impact | Artifact                                                   | Proves                                                                    | Next                                                  |
| ----------------------------------------- | ------------------- | -------- | ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| `postgres-40-schema-shape-rows`           | schema shapes       | `passed` | `+7% / 0% / 0%`                            | `postgres-clean-logical-20-claim-ready-report.json`        | three clean logical schema shapes restore with target-native verifiers    | Add extension/larger schema rows before a 60% claim.  |
| `postgres-40-version-rows`                | PostgreSQL versions | `passed` | `+5% / 0% / 0%`                            | `postgres-clean-logical-20-claim-ready-report.json`        | PostgreSQL 14, 15, and 16 fixtures restore with retained verifiers        | Add version/extension variation before a 60% claim.   |
| `postgres-40-workload-mix-rows`           | workload mix        | `passed` | `+5% / 0% / 0%`                            | `postgres-clean-logical-20-claim-ready-report.json`        | read-only, committed write batch, and aggregate workloads restore cleanly | Add larger datasets and failure-mode rows.            |
| `postgres-40-retained-verifier-artifacts` | retained artifacts  | `passed` | `+3% / 0% / 0%`                            | `source-verifier.txt / target-verifier.txt / summary JSON` | every 40% row retains source/target verifier artifacts and hashes         | Define a new 60% gate with retained verifier outputs. |

## Refusal boundaries retained

- active transactions / sessions;
- dirty WAL without a clean checkpoint boundary;
- physical data-dir cross-ISA copy;
- broad service/workload support;
- arbitrary Linux process restore.
