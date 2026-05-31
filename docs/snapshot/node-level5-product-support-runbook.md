# Node Level 5 product support runbook

This runbook applies to the 20%, 50%, 65%, and 80% Node product support tiers. The current shipped claim is 80% Node product support, 20% broad Node product support, and 0% arbitrary process cross-architecture restore. The next candidate milestone is documented in [Node Level 5 next claim milestone](./node-level5-product-support-next-milestone.md), but it is not claimed yet.

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

Treat a failure as a product bug only when it is inside a supported matrix row, uses the public VM-first snapshot path, and has retained artifacts.

For the 50% tier, also collect the compatibility matrix row and release-checklist evidence for the reported family.

For the 65% tier, identify whether the case is an active async idle boundary, TLS boundary policy, or child process boundary issue. Live TLS migration, in-flight async work, and live child process continuation remain unsupported.

For the 80% tier, also identify the selected app row, real-app corpus row, refusal-corpus row, or support-matrix row that covers the report. The product path is `machinen snapshot <vm-name> --out <dir>` followed by `machinen restore <dir>`; Node support is detected inside the VM.

For the candidate 85 / 25 / 0 milestone, retain the `genericVmCorpus` release-gate report from `scripts/smoke/node-level5-generic-vm-corpus.sh` and the VM restore/probe log from `scripts/smoke/node-level5-vm-detected-product-snapshot.sh`. These are candidate artifacts only; they do not raise the claim registry while `claimChangeAllowed` remains `false`.

Treat everything else as unsupported unless the product support matrix is expanded and the claim registry is intentionally raised.
