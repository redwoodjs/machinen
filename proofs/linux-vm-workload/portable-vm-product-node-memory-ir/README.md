# Portable VM product Node memory IR proof

Retains product CLI evidence that `machinen snapshot <vm> --portable --out <bundle>` detects a source bundle carrying `nodejs-memory-ir.json`, emits `nodejs-memory-classification.json`, adds a `nodejs-memory-ir` plan row, and that `machinen restore <bundle> --json` injects the product-owned `nodejs-memory-materializer.mjs`, materializes the memory IR into a target-native Node app, and verifies its `/state` endpoint.

Also retains a fail-closed product refusal for `nodejs-memory-pending-promise.refuse` with `node-portability-memory-pending-promise-unsupported`.

This proof does not claim raw V8 heap restore, same-PID continuation, arbitrary Node process restore, arbitrary Linux process restore, or raw VM/vCPU/device replay.
