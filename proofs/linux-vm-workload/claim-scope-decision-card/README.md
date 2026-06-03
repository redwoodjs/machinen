# Whole-VM workload claim-scope decision card

Status: `verified`

Scope: `whole-vm-corpus-claim-scope-decision-v1`

This retained proof gate is claim-guarded. It does not claim arbitrary VM restore, arbitrary Linux process restore, source ISA emulation, raw CPU/vCPU replay, or metadata-only success.

## Summary

- Recommendation: keep-current-public-claim-scope
- Public claim change allowed: false
- Product-gated rows: 4
- Product-refused rows: 4

## Rows

- Supported broader-corpus rows have retained product-gate artifacts, but refused neighbors still bound the corpus.
- The product-gated corpus rows are selected workload rows, not arbitrary VM restore evidence.
- Raw VM-state replay, cross-ISA vCPU replay, source ISA emulation, and metadata-only success remain forbidden.
- Public claim language remains scoped to selected-whole-vm-workload-v1 until an explicit broader claim card is approved.

## Retained report

- `retained/whole-vm-workload-claim-scope-decision-card-report.json`
