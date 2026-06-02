# Native resource coverage matrix

Status: `verified-resource-matrix`

This retained matrix is the resource-row inventory for the selected native
process proof track. Every row is either:

- `verified-resource-seed` — a selected target-native resource reconstruction
  seed with retained target plan checks, or
- `verified-refusal` — an unsupported resource boundary with retained exact
  refusal codes/details.

It does not raise public product support or arbitrary Linux process restore. It
exists so later scoped-native claims can require zero `not-proven` resource rows
before promotion.

Run:

```sh
bash scripts/smoke/native-resource-coverage-matrix.sh
```

Retained outputs:

- `proofs/native-process-substrate/resource-coverage/retained/native-resource-coverage-matrix-report.json`
- `proofs/native-process-substrate/resource-coverage/retained/row-proofs/*/row-proof.json`

The matrix also requires the bidirectional regular-file FD proof:

- `proofs/native-process-substrate/regular-file-fd-bidirectional/retained/native-regular-file-fd-bidirectional-proof-report.json`
