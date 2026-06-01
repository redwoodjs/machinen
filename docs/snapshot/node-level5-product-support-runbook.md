# Node Level 5 product support runbook

This runbook applies to the 20%, 50%, 65%, 80%, 85%, and 90% Node product support tiers. The current shipped claim is 100% Node product support, 100% broad Node product support, and 0% arbitrary process cross-architecture restore.

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

For the 85 / 25 / 0 tier, also identify the generic VM row, retained-evidence report, row-artifact report, refusal-artifact report, and claim-ready report that covers the case. Retain the VM restore/probe log from `scripts/smoke/node-level5-vm-detected-product-snapshot.sh`.

For the 100 / 100 / 0 framework tier, collect the framework capability, readiness, product-evidence, and claim-ready reports:

```sh
machinen node-level5 framework-capabilities --json
machinen node-level5 framework-readiness \
  --framework-introspection-corpus-report ./node-level5-framework-introspection-corpus-report.json \
  --json
machinen node-level5 framework-claim-ready \
  --readiness-report ./node-level5-framework-readiness.json \
  --framework-product-evidence-report ./node-level5-framework-product-evidence-report.json \
  --json
```

The framework claim-ready report must cover Express route/middleware/settings/error-handler graph artifacts, Fastify plugin/decorator/hook/schema/route graph artifacts, restored behavior probes tied to those artifacts, and refusal artifacts for active requests, worker threads, native addons, TLS active state, and child processes. Arbitrary Express, Fastify, Node, and arbitrary process cross-architecture restore remain unclaimed.

For the arbitrary-process seed track, collect the seed matrix and retained seed artifacts:

```sh
machinen node-level5 arbitrary-process-seed --out ./arbitrary-process-seed --json
```

This seed track does not raise arbitrary process cross-architecture restore above `0%`. Treat threads, JIT code, futex-owned locks, live sockets, device mmap, and active epoll as refused until a future native-process claim-ready gate passes.

Treat everything else as unsupported unless the product support matrix is expanded and the claim registry is intentionally raised.
