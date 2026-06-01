# Postgres service workload 100 / 80 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/100-80-0`

Scope: Broader app corpus, tenant/policy workloads, operational runbook, and service-level negative tests.

Promotion effect: Raises bounded Postgres broad service/workload support to 80%; arbitrary Linux process restore stays 0%.

## Claim numbers

```json
{
  "productSupport": 100,
  "broadSupport": 80,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained service workload claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps a source workload transcript, target workload transcript, and restore summary with shortcut checks. New app connections are opened after restore; live source sessions are not continued.

## Proof impact rows

| Proof                                      | Category               | Status   | Product / broad / arbitrary-process impact | Artifact                                                                        | Proves                                                                 | Next                                    |
| ------------------------------------------ | ---------------------- | -------- | ------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| `postgres-broad-80-api-corpus`             | API app corpus         | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-80-0/retained/100-80-0-service-workload-claim-report.json` | API-backed workload corpus passes against restored target PostgreSQL   | Add release corpus before 100%.         |
| `postgres-broad-80-tenant-policy`          | tenant/policy workload | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-80-0/retained/100-80-0-service-workload-claim-report.json` | tenant roles/policies isolate app queries after restore                | Add final policy audit before 100%.     |
| `postgres-broad-80-operational-runbook`    | operational runbook    | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-80-0/retained/100-80-0-service-workload-claim-report.json` | operator runbook captures/imports/verifies service workload artifacts  | Add release checklist before 100%.      |
| `postgres-broad-80-negative-service-tests` | negative service tests | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-80-0/retained/100-80-0-service-workload-claim-report.json` | live service state neighbors remain refused and do not inflate support | Keep replication/failover out of scope. |

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
