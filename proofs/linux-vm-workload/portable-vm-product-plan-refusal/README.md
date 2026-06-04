# Portable VM product plan refusal

Status: `verified`

Scope: `portable-vm-all3-product-snapshot-restore-v1`

This proof verifies that `machinen restore <portable-vm-bundle> --json` consumes the generated Portable VM Manifest / VM Portability Plan before booting a target VM. A refused plan row for active network streams returns the stable refusal code `portable-vm-active-network-stream-unsupported` and does not claim arbitrary VM restore.

## Result

- Plan consumed: true
- Refused before target VM boot: true
- Refusal code: `portable-vm-active-network-stream-unsupported`
- Arbitrary VM restore claimed: false

## Retained artifacts

- `retained/portable-vm-product-plan-refusal-report.json`
- `retained/restore.json`
- `retained/refused-portable-vm.snap/portable-vm-manifest-plan.json`
- `retained/refused-portable-vm.snap/portable-vm-product-restore-summary.json`
