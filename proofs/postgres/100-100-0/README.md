# Postgres service workload 100 / 100 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/100-100-0`

Scope: Final bounded broad support claim for clean, idle logical PostgreSQL service workloads after target-native restore. This is still not active runtime continuation or arbitrary Linux process restore.

Promotion effect: Raises bounded Postgres broad service/workload support to 100%; arbitrary Linux process restore stays 0%.

## Claim numbers

```json
{
  "productSupport": 100,
  "broadSupport": 100,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained service workload claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps a source workload transcript, target workload transcript, and restore summary with shortcut checks. New app connections are opened after restore; live source sessions are not continued.

## Proof impact rows

| Proof                                  | Category          | Status   | Product / broad / arbitrary-process impact | Artifact                                                                          | Proves                                                                                                                                                                        | Next                                                    |
| -------------------------------------- | ----------------- | -------- | ------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `postgres-broad-100-release-corpus`    | release corpus    | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-100-0/retained/100-100-0-service-workload-claim-report.json` | combined clean logical service workload release corpus passes                                                                                                                 | Maintain release corpus for future claim changes.       |
| `postgres-broad-100-behavioral-parity` | behavioral parity | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-100-0/retained/100-100-0-service-workload-claim-report.json` | source/target workload transcripts and query result hashes match                                                                                                              | Keep target verifier artifacts retained.                |
| `postgres-broad-100-refusal-audit`     | refusal audit     | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-100-0/retained/100-100-0-service-workload-claim-report.json` | active sessions/transactions, dirty WAL, physical copy, replication/failover, emulation, sidecars, hooks, metadata-only success, and arbitrary-process restore remain refused | Use separate product tracks to reduce these boundaries. |
| `postgres-broad-100-product-contract`  | product contract  | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-100-0/retained/100-100-0-service-workload-claim-report.json` | public 100% broad claim is bounded to clean logical PostgreSQL service workloads after target-native restore                                                                  | Do not claim live database runtime continuation.        |

## Refusal boundaries retained

- active sessions at capture;
- active transactions at capture;
- dirty WAL boundary;
- physical data-dir cross-ISA copy;
- live connection/socket continuation;
- replication/failover state;
- source-ISA emulation;
- sidecar replay;
- app checkpoint hooks;
- metadata-only success;
- arbitrary Linux process restore;
