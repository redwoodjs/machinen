# Postgres service workload 100 / 60 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/100-60-0`

Scope: Extension/policy/trigger service behavior and failure-mode rows for clean logical restore workloads.

Promotion effect: Raises bounded Postgres broad service/workload support to 60%; arbitrary Linux process restore stays 0%.

## Claim numbers

```json
{
  "productSupport": 100,
  "broadSupport": 60,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained service workload claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps a source workload transcript, target workload transcript, and restore summary with shortcut checks. New app connections are opened after restore; live source sessions are not continued.

## Proof impact rows

| Proof                                | Category                 | Status   | Product / broad / arbitrary-process impact | Artifact                                                                        | Proves                                                                       | Next                                            |
| ------------------------------------ | ------------------------ | -------- | ------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `postgres-broad-60-trigger-policy`   | triggers/policies        | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-60-0/retained/100-60-0-service-workload-claim-report.json` | deterministic triggers and RLS policy behavior pass app-level verifier       | Add final service corpus breadth before 80%.    |
| `postgres-broad-60-jsonb-search`     | jsonb/search workload    | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-60-0/retained/100-60-0-service-workload-claim-report.json` | jsonb search/filter workload returns matching target results                 | Add text/search extension variation before 80%. |
| `postgres-broad-60-failure-refusal`  | failure/refusal behavior | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-60-0/retained/100-60-0-service-workload-claim-report.json` | unsafe service states fail closed rather than becoming metadata-only success | Keep refusal audit in every higher claim.       |
| `postgres-broad-60-operational-size` | operational size         | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-60-0/retained/100-60-0-service-workload-claim-report.json` | larger logical import path retains service verifier parity                   | Add performance/runbook evidence before 80%.    |

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
