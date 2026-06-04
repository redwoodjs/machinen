# Selected native product-path E2E gate

This proof runs the product command surface for the selected native workload:

- `machinen capture native`
- `machinen restore <bundle> --target-arch <arch> --target-verifier-output <file>`

It retains both cross-architecture directions and verifies that the bundle stays proof-only:

- no raw CPU restore;
- no source ISA emulation;
- no runtime-profile restore;
- no sidecar replay or app hook;
- no metadata-only success;
- no arbitrary Linux process restore claim.

The source and target verifier artifacts are retained target-native executions from the accepted bidirectional selected-workload harness. This gate proves the product command path can consume those retained artifacts for the selected single-thread workload only. It does **not** raise broad native product support or arbitrary process restore support.

Run:

```sh
bash scripts/smoke/native-product-e2e-gate.sh
```

Retained report:

- `retained/native-product-e2e-gate-report.json`
