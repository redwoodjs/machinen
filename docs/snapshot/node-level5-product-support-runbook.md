# Node Level 5 product support runbook

This runbook applies to the 20%, 50%, and 65% Node product support tiers. The 65% tier covers fourteen declared service and boundary families only.

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

For the 50% tier, also collect the compatibility matrix row and release-checklist evidence for the reported family.

For the 65% tier, identify whether the case is an active async idle boundary, TLS boundary policy, or child process boundary issue. Live TLS migration, in-flight async work, and live child process continuation remain unsupported.

Treat everything else as unsupported unless the product support matrix is expanded.
