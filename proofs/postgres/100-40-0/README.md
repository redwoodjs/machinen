# Postgres service workload 100 / 40 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/100-40-0`

Scope: Multiple clean logical service workload shapes with ORM-style access, migrations, indexes, and cold-start connection behavior.

Promotion effect: Raises bounded Postgres broad service/workload support to 40%; arbitrary Linux process restore stays 0%.

## Claim numbers

```json
{
  "productSupport": 100,
  "broadSupport": 40,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained service workload claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps a source workload transcript, target workload transcript, and restore summary with shortcut checks. New app connections are opened after restore; live source sessions are not continued.

## Proof impact rows

| Proof                                     | Category            | Status   | Product / broad / arbitrary-process impact | Artifact                                                                        | Proves                                                                                               | Next                                          |
| ----------------------------------------- | ------------------- | -------- | ------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `postgres-broad-40-orm-crud`              | ORM workload        | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-40-0/retained/100-40-0-service-workload-claim-report.json` | ORM-style CRUD transcript passes after restore                                                       | Add extension/policy service rows before 60%. |
| `postgres-broad-40-migration-shape`       | migrations          | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-40-0/retained/100-40-0-service-workload-claim-report.json` | committed schema migrations are present and verifiable after restore                                 | Add larger migration corpus before 80%.       |
| `postgres-broad-40-index-query-plan`      | indexes/constraints | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-40-0/retained/100-40-0-service-workload-claim-report.json` | indexed lookups and expected constraint failures behave after restore                                | Add partition/query corpus before 80%.        |
| `postgres-broad-40-connection-cold-start` | service connection  | `passed` | `0% / +5% / 0%`                            | `proofs/postgres/100-40-0/retained/100-40-0-service-workload-claim-report.json` | applications reconnect cold to the restored target service; live socket continuation remains refused | Keep live client sessions refused.            |

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
