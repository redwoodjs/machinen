# Postgres clean logical product track

Status: `product-track-existing`

Track: `postgres`

Proof directory: `proofs/postgres/logical-product-track`

Scope: Clean, idle logical Postgres reconstruction; percent claim ladder not defined yet.

Promotion effect: Needs Postgres-specific claim ladder and retained verifier artifacts before a percent-style claim.

## Claim numbers

```json
{
  "productSupport": "to-be-defined",
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Proofs

| Proof                    | Category       | Status                        | Artifact                       | Proves                                                                           | Claim use                       | Next                                      |
| ------------------------ | -------------- | ----------------------------- | ------------------------------ | -------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| `postgres-clean-logical` | database state | `implemented-product-support` | `portable-product.json`        | logical dump and target verifier based reconstruction                            | existing product track evidence | Convert to Postgres claim ladder.         |
| `postgres-refusals`      | refusals       | `refused`                     | `product-portable-postgres.ts` | active transactions, dirty WAL, and physical data-dir cross-ISA copy are refused | bounds Postgres support         | Add dashboard-visible Postgres artifacts. |
