# Postgres service workload 100 / 20 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/100-20-0`

Scope: First bounded clean logical service-workload claim: application-style read/write behavior, query result parity, roles/auth, and post-restore transaction semantics.

Promotion effect: Raises bounded Postgres broad service/workload support to 20%; arbitrary Linux process restore stays 0%.

## Claim numbers

```json
{
  "productSupport": 100,
  "broadSupport": 20,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained service workload claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps a source workload transcript, target workload transcript, and restore summary with shortcut checks. New app connections are opened after restore; live source sessions are not continued.

## Proof impact rows

| Proof                                         | Category                  | Status   | Product / broad / arbitrary-process impact | Artifact                                                                        | Proves                                                                                             | Next                                         |
| --------------------------------------------- | ------------------------- | -------- | ------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `postgres-broad-20-app-read-write`            | application workload      | `passed` | `0% / +6% / 0%`                            | `proofs/postgres/100-20-0/retained/100-20-0-service-workload-claim-report.json` | app-style read/write workload passes after target-native restore                                   | Add multiple app workload shapes before 40%. |
| `postgres-broad-20-query-result-parity`       | query parity              | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-20-0/retained/100-20-0-service-workload-claim-report.json` | read/query result transcript matches source verifier output                                        | Add ORM and migration rows before 40%.       |
| `postgres-broad-20-roles-auth`                | roles/auth                | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-20-0/retained/100-20-0-service-workload-claim-report.json` | roles, grants, and auth-facing permissions survive logical restore                                 | Add policy/tenant rows before 60%.           |
| `postgres-broad-20-post-restore-transactions` | post-restore transactions | `passed` | `0% / +4% / 0%`                            | `proofs/postgres/100-20-0/retained/100-20-0-service-workload-claim-report.json` | new transactions after restore behave correctly while in-flight source transactions remain refused | Keep active source transactions refused.     |

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
