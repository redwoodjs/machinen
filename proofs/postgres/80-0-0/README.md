# Postgres clean logical 80 / 0 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/80-0-0`

Scope: Adds advanced clean logical schema/database-code/policy/mixed-workload rows while keeping active state refused.

Promotion effect: Raises bounded clean logical Postgres product support to 80%; broad service/workload support and arbitrary Linux process restore stay 0%.

## Claim numbers

```json
{
  "productSupport": 80,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps source verifier output, target verifier output, and a restore summary with shortcut checks.

## Proof impact rows

| Proof                                    | Category           | Status   | Product / broad / arbitrary-process impact | Artifact                                                   | Proves                                                                                       | Next                                           |
| ---------------------------------------- | ------------------ | -------- | ------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `postgres-80-partitioned-table-rows`     | advanced schema    | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/80-0-0/retained/80-0-0-claim-report.json` | partitioned tables and partition indexes restore through target-native logical import        | Add final release corpus breadth before 100%.  |
| `postgres-80-view-function-trigger-rows` | database code      | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/80-0-0/retained/80-0-0-claim-report.json` | views, SQL functions, and deterministic triggers restore as logical DDL, not source-ISA code | Keep non-deterministic runtime state refused.  |
| `postgres-80-policy-role-rows`           | roles and policies | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/80-0-0/retained/80-0-0-claim-report.json` | roles, grants, and row-level security policies are retained and verified                     | Add operational restore checklist before 100%. |
| `postgres-80-mixed-ddl-dml-corpus`       | mixed workload     | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/80-0-0/retained/80-0-0-claim-report.json` | mixed committed DDL/DML corpus restores with source/target checksum equality                 | Add final refusal audit before 100%.           |

## Refusal boundaries retained

- active transactions / sessions;
- dirty WAL boundary;
- physical data-dir cross-ISA copy;
- source-ISA emulation;
- sidecar replay;
- metadata-only success;
- broad service/workload support;
- arbitrary Linux process restore;
