# Postgres clean logical 100 / 0 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/100-0-0`

Scope: Final bounded claim for clean, idle logical Postgres reconstruction. This is not broad service support or arbitrary Linux process restore.

Promotion effect: Raises bounded clean logical Postgres product support to 100%; broad service/workload support and arbitrary Linux process restore stay 0%.

## Claim numbers

```json
{
  "productSupport": 100,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps source verifier output, target verifier output, and a restore summary with shortcut checks.

## Proof impact rows

| Proof                               | Category            | Status   | Product / broad / arbitrary-process impact | Artifact                                                     | Proves                                                                                                                                            | Next                                                                       |
| ----------------------------------- | ------------------- | -------- | ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `postgres-100-release-corpus`       | release corpus      | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/100-0-0/retained/100-0-0-claim-report.json` | combined clean logical release corpus covers schema, data, version, policy, and workload rows                                                     | Maintain release corpus before changing support wording.                   |
| `postgres-100-bidirectional-matrix` | architecture matrix | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/100-0-0/retained/100-0-0-claim-report.json` | all accepted rows retain amd64<->arm64 target-native verifier artifacts                                                                           | Keep both architecture directions required.                                |
| `postgres-100-refusal-audit`        | refusal audit       | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/100-0-0/retained/100-0-0-claim-report.json` | active sessions, active transactions, dirty WAL, physical data-dir copy, emulation, sidecars, app hooks, and metadata-only success remain refused | Only new product tracks can reduce these boundaries.                       |
| `postgres-100-product-contract`     | product contract    | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/100-0-0/retained/100-0-0-claim-report.json` | the public 100% claim is bounded to clean idle logical PostgreSQL reconstruction with retained artifacts                                          | Do not market this as broad service/workload or arbitrary-process restore. |

## Refusal boundaries retained

- active transactions / sessions;
- dirty WAL boundary;
- physical data-dir cross-ISA copy;
- source-ISA emulation;
- sidecar replay;
- metadata-only success;
- broad service/workload support;
- arbitrary Linux process restore;
