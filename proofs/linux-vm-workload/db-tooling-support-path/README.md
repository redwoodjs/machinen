# Whole-VM clean DB tooling support path

Status: `verified`

Scope: `whole-vm-clean-db-tooling-support-path-v1`

This retained proof gate is claim-guarded. It does not claim arbitrary VM restore, arbitrary Linux process restore, source ISA emulation, raw CPU/vCPU replay, or metadata-only success.

## Summary

- Clean DB product gates verified: 2
- Clean DB directions verified: 4
- Dirty/active DB refusals verified: 2
- Arbitrary VM restore rows added: 0

## Rows

- `whole-vm-sqlite-clean-db-workload` — `tooling-product-supported` — `retained/whole-vm-sqlite-clean-db-workload-tooling-product-gate.json`
- `whole-vm-postgresql-clean-workload` — `tooling-product-supported` — `retained/whole-vm-postgresql-clean-workload-tooling-product-gate.json`
- `whole-vm-sqlite-dirty-wal-hot-journal-refusal` — `whole-vm-dirty-db-state-unsupported` — `retained/whole-vm-sqlite-dirty-wal-hot-journal-refusal.json`
- `whole-vm-postgresql-active-transaction-dirty-wal-refusal` — `whole-vm-active-db-state-unsupported` — `retained/whole-vm-postgresql-active-transaction-dirty-wal-refusal.json`

## Retained report

- `retained/whole-vm-db-tooling-support-path-report.json`
