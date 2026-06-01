# Postgres clean logical 60 / 0 / 0 claim

Status: `claimed`

Track: `postgres`

Proof directory: `proofs/postgres/60-0-0`

Scope: Extends the clean logical claim with extension/type, larger dataset, multi-schema/ownership, and negative refusal retained verifier rows.

Promotion effect: Raises bounded clean logical Postgres product support to 60%; broad service/workload support and arbitrary Linux process restore stay 0%.

## Claim numbers

```json
{
  "productSupport": 60,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

The retained claim report and per-row verifier artifacts are under `retained/`. Each accepted row keeps source verifier output, target verifier output, and a restore summary with shortcut checks.

## Proof impact rows

| Proof                                 | Category              | Status   | Product / broad / arbitrary-process impact | Artifact                                                   | Proves                                                                                                   | Next                                                |
| ------------------------------------- | --------------------- | -------- | ------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `postgres-60-extension-type-rows`     | extension/type shapes | `passed` | `+6% / 0% / 0%`                            | `proofs/postgres/60-0-0/retained/60-0-0-claim-report.json` | jsonb, arrays, enums, generated columns, and extension-like logical objects restore with verifier hashes | Add trigger/function and partition rows before 80%. |
| `postgres-60-larger-dataset-row`      | larger dataset        | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/60-0-0/retained/60-0-0-claim-report.json` | larger committed datasets restore with source/target checksum equality                                   | Add broader dataset shapes before 80%.              |
| `postgres-60-multi-schema-ownership`  | schema ownership      | `passed` | `+5% / 0% / 0%`                            | `proofs/postgres/60-0-0/retained/60-0-0-claim-report.json` | multiple schemas, owners, privileges, and search_path are captured in the logical unit                   | Add role/policy variation before 80%.               |
| `postgres-60-negative-refusal-matrix` | refusals              | `passed` | `+4% / 0% / 0%`                            | `proofs/postgres/60-0-0/retained/60-0-0-claim-report.json` | corrupt dumps, verifier mismatch, active sessions, dirty WAL, and physical copy remain refused           | Keep refusals explicit through 100%.                |

## Refusal boundaries retained

- active transactions / sessions;
- dirty WAL boundary;
- physical data-dir cross-ISA copy;
- source-ISA emulation;
- sidecar replay;
- metadata-only success;
- broad service/workload support;
- arbitrary Linux process restore;
