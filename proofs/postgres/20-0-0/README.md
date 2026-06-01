# Postgres clean logical 20 / 0 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/20-0-0`

Scope: Clean, idle logical Postgres reconstruction only; physical data-dir cross-ISA copy remains refused.

Promotion effect: Raises Postgres product support to 20%; broad service/workload support and arbitrary Linux process restore stay 0%.

## Claim numbers

```json
{
  "productSupport": 20,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained claim ladder report is in
`retained/postgres-claim-ladder-report.json`. It keeps arm64-to-amd64 and
amd64-to-arm64 logical restore bundles, source verifier output, target verifier
output, restore summaries, and an unsafe-state refusal artifact.

## Proof impact rows

| Proof                                       | Category                   | Status             | Product / broad / arbitrary-process impact | Artifact                                    | Proves                                                                                     | Next                                                         |
| ------------------------------------------- | -------------------------- | ------------------ | ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `postgres-clean-logical-capture`            | database state             | `passed`           | `8% / 0% / 0%`                             | `portable-product.json`                     | clean, idle logical PostgreSQL capture is a portable unit                                  | Add more workload shapes before moving beyond 20%.           |
| `postgres-bidirectional-cross-arch-restore` | cross-architecture restore | `passed`           | `5% / 0% / 0%`                             | `restore-summary.json`                      | arm64->amd64 and amd64->arm64 target-native verifier output passes                         | Retain more version and schema-shape rows for the 40% gate.  |
| `postgres-retained-verifier-artifacts`      | retained artifacts         | `passed`           | `4% / 0% / 0%`                             | `source-verifier.txt / target-verifier.txt` | source and target verifier outputs are retained with hashes                                | Standardize artifact retention for future Postgres rows.     |
| `postgres-explicit-refusal-boundaries`      | refusals                   | `refused-boundary` | `3% / 0% / 0%`                             | `portable-product-refusal.json`             | active transactions, dirty WAL, active sessions, and physical data-dir copy remain refused | Only reduce refusals with a new target-native verifier gate. |
