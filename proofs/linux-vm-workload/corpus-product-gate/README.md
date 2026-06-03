# Whole-VM workload corpus product gate

Status: `verified`

Scope: `whole-vm-supported-corpus-product-artifacts-v1`

This gate converts the supported proof-only whole-VM corpus rows into retained product-gate artifacts. It does **not** claim arbitrary VM restore, raw VM-state replay, source ISA emulation, or arbitrary Linux process restore.

## Summary

- Supported corpus rows required: 4
- Product gate rows verified: 4
- Product gate directions verified: 8
- Corpus product support rows added: 4
- Arbitrary VM restore rows added: 0
- Public claim rows added: 0

## Supported product-gate rows

- `whole-vm-c-service-workload` — arm64-to-amd64, amd64-to-arm64 — `retained/whole-vm-c-service-workload-product-gate.json`
- `whole-vm-filesystem-workload` — arm64-to-amd64, amd64-to-arm64 — `retained/whole-vm-filesystem-workload-product-gate.json`
- `whole-vm-network-listener-workload` — arm64-to-amd64, amd64-to-arm64 — `retained/whole-vm-network-listener-workload-product-gate.json`
- `whole-vm-multi-process-workload` — arm64-to-amd64, amd64-to-arm64 — `retained/whole-vm-multi-process-workload-product-gate.json`

## Claim guard

- Public claim allowed: `false`
- Claim change allowed: `false`
- Arbitrary VM restore claimed: `false`
- Arbitrary Linux process restore claimed: `false`
- Current claim scope remains: `selected-whole-vm-workload-v1 only`

## Retained artifacts

- `retained/whole-vm-workload-corpus-product-gate-report.json`
- `retained/*-product-gate.json` for the 4 supported corpus rows
