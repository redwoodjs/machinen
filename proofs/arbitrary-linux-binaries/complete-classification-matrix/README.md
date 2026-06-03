# Complete arbitrary-process state classification proof matrix

Status: `verified`

Scope: `declared-arbitrary-process-state-classification-v1`

Proof rows: `arbitrary/020` through `arbitrary/039`

This matrix turns every declared arbitrary-process state class into a retained proof row. Supported rows keep a `*-proof.json` executable fixture verifier artifact. Refused rows keep a `*-proof.json` stable-refusal verifier artifact that refuses before target execution. Product support remains out of scope, and arbitrary process restore remains unclaimed.

## Summary

- Required rows: 20
- Verified rows: 20
- Retained row proof artifacts: 20
- Executable fixture proofs: 6
- Supported target-verifier proofs: 6
- Stable refusal proofs: 14
- Supported-proof rows: 6
- Refused rows: 14
- Unknown rows: 0
- Declared state classes classified: 100%
- Public arbitrary process restore claim: 0

## Proof quality

- `executable-fixture-proof`: 6 supported rows run a retained executable fixture verifier.
- `stable-refusal-proof`: 14 refused rows retain stable refusal-code verifier artifacts.
- Product-path proof: 0 rows; product support remains out of scope for arbitrary process work.

## Claim effect

```json
{
  "productSupport": null,
  "broadSupport": null,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Retained artifacts

- `retained/arbitrary-process-complete-classification-matrix-report.json`
- `retained/*-proof.json` for all 20 rows
- `retained/*.json` row summaries for all 20 rows
