# Node Level 5 product support runbook

This runbook applies to the 20% Node product support tier: five idle service families only.

## Collect artifacts

For every support case, collect:

- Capture manifest.
- Capture summary.
- Restore summary.
- Refusal summary if the workload was refused.
- Source and target architecture.
- Node, V8, and libuv versions.
- Target verification output.

## Common refusals

Common supported-boundary refusals include:

- `node-level5-active-request-refused`
- `node-level5-tls-refused`
- `node-level5-worker-thread-refused`
- `node-level5-native-addon-refused`
- `node-level5-wasm-refused`
- `node-level5-external-memory-refused`
- `node-level5-fs-watcher-refused`
- `node-level5-raw-cpu-restore-refused`
- `node-level5-source-isa-emulation-refused`

## Escalation boundary

Treat a failure as a product bug only when it is inside one of the five supported idle service families, uses the pinned runtime versions, and has retained artifacts.

Treat everything else as unsupported unless the product support matrix is expanded.
