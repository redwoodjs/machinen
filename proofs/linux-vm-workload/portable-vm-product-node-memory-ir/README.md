# Portable VM product Node memory IR proof

Retains product CLI evidence that `machinen snapshot <vm> --portable --out <bundle>` detects a source bundle carrying `nodejs-memory-ir.json`, emits `nodejs-memory-classification.json`, adds a `nodejs-memory-ir` plan row, and that `machinen restore <bundle> --json` injects the product-owned `nodejs-memory-materializer.mjs`, materializes selected semantic Memory IR rows into a target-native Node app, and verifies `/state` plus `/rows`.

The accepted row matrix is caniuse-style evidence for selected semantic rows: plain object, closure context, string, nested object graph, shared references, cycle, Map/Set, class instance, Buffer, TypedArray, and HTTP handler closure state. Each retained row records `detect -> capture -> decode -> classify -> materialize -> verify -> retain` evidence. It is not a raw process/V8 continuation claim.

Also retains a fail-closed product refusal for `nodejs-memory-pending-promise.refuse` with `node-portability-memory-pending-promise-unsupported`.

This proof does not claim raw V8 heap restore, same-PID continuation, arbitrary Node process restore, arbitrary Linux process restore, or raw VM/vCPU/device replay.
