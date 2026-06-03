# Portable VM inventory plan proof

Status: `verified`

Scope: `controlled-portable-vm-inventory-plan-v1`

This is the first proof-first implementation of the portable VM workflow. It builds a controlled paused-VM raw inventory, classifies every row, emits a generated portable VM manifest/plan, and retains a pause/quiesce transcript. It does not claim arbitrary VM restore.

## Summary

- Raw inventory items: 12
- Plan rows: 12
- Portable rows: 1
- Reconstructable rows: 4
- Product-supported rows: 2
- Refused rows: 5
- Unknown rows accepted: 0
- Product support rows added: 0
- Arbitrary VM restore rows added: 0

## Retained artifacts

- `retained/controlled-vm-raw-inventory.json`
- `retained/controlled-vm-pause-quiesce-transcript.json`
- `retained/portable-vm-manifest-plan.generated.json`
- `retained/portable-vm-inventory-plan-report.json`
