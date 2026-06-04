# Node real cross-architecture E2E gate

Status: `partial-proof`

This gate now contains retained real product-path seed evidence for a clean Node HTTP service in both architecture directions.

It does **not** restore the previous `100 / 100 / 0` claim. The retained seed proves that the real VM-first product path works for one clean HTTP service row in both directions. A high public claim still requires row-by-row retained E2E bundles and refusal artifacts.

## Retained validated seed artifacts

- `retained/arm64-to-amd64/`
  - source command: `machinen snapshot <vm-name> --out <dir>`
  - target command: `machinen restore <dir>`
  - target restore: `target/restore.json`
  - target behavior: `target/target-http-body.txt`
- `retained/amd64-to-arm64/`
  - source command: `machinen snapshot <vm-name> <out-dir>`
  - target command: `machinen restore <dir>`
  - target restore: `target/restore.json`
  - target behavior: `target/target-http-body.txt`

The validator checks:

- retained source snapshot summary exists and was not a dry run;
- portable Node manifest source architecture matches the direction;
- retained app tarball hash/size matches the manifest;
- target restore completed on the opposite architecture;
- target HTTP body hash/size matches the source verifier;
- source ISA emulation, source-text replay, sidecars, and app hooks are all reported false.

Run the retained-artifact validator directly:

```sh
bash scripts/smoke/node-real-cross-arch-e2e-gate.sh
```

## Still required before restoring 100 / 100 / 0

1. Retained bidirectional E2E bundles for every supported Node support-matrix row.
2. Refusal artifacts for unsupported workers, native addons, Wasm/external memory, TLS active state, active async work, child process live state, raw CPU restore, source ISA emulation, sidecars, app hooks, and metadata-only success.
3. Dashboard/claim registry update that ties each public claim row to retained artifacts.

Until those are complete, Node remains `0 / 0 / 0` in the public claim dashboard.
