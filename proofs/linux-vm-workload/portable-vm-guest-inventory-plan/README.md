# Portable VM guest inventory plan proof

Status: `verified`

Scope: `fixture-guest-inventory-portable-vm-plan-v1`

This proof consumes a fixture guest inventory input through the guest inventory contract, derives raw inventory rows, classifies each row into a VM Portability Plan, and retains all inputs/transcripts/outputs. It is workflow evidence only and does not claim arbitrary VM restore.

## Summary

- Contract fields verified: 11
- Guest input rows: 12
- Raw inventory rows from guest input: 12
- Plan rows: 12
- Refused rows: 5
- Unknown rows accepted: 0
- Product support rows added: 0
- Arbitrary VM restore rows added: 0

## Retained artifacts

- `retained/portable-vm-guest-inventory-contract.json`
- `retained/guest-inventory-input.json`
- `retained/guest-inventory-collector-transcript.json`
- `retained/guest-derived-raw-inventory.json`
- `retained/portable-vm-manifest-plan.generated.json`
- `retained/portable-vm-guest-inventory-plan-report.json`
