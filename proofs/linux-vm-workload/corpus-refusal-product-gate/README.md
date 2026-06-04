# Whole-VM workload corpus refusal product gate

Status: `verified`

Scope: `whole-vm-refused-corpus-product-refusals-v1`

This retained proof gate is claim-guarded. It does not claim arbitrary VM restore, arbitrary Linux process restore, source ISA emulation, raw CPU/vCPU replay, or metadata-only success.

## Summary

- Product refusal rows verified: 4
- Product refusal directions verified: 8
- Arbitrary VM restore rows added: 0
- Public claim rows added: 0

## Rows

- `whole-vm-sqlite-clean-db-workload` — `product-refused` — `whole-vm-workload-tool-missing` — `retained/whole-vm-sqlite-clean-db-workload-product-refusal.json`
- `whole-vm-postgresql-clean-workload` — `product-refused` — `whole-vm-workload-tool-missing` — `retained/whole-vm-postgresql-clean-workload-product-refusal.json`
- `whole-vm-java-service-workload` — `product-refused` — `whole-vm-workload-tool-missing` — `retained/whole-vm-java-service-workload-product-refusal.json`
- `whole-vm-dirty-active-opaque-state-refusals` — `product-refusal-defined` — `whole-vm-dirty-active-opaque-state-unsupported` — `retained/whole-vm-dirty-active-opaque-state-refusals-product-refusal.json`

## Retained report

- `retained/whole-vm-workload-corpus-refusal-product-gate-report.json`
