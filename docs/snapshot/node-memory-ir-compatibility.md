# Node Memory IR compatibility

This page is the product-facing compatibility summary for selected semantic Node Memory IR materialization.

The product path is:

```sh
machinen snapshot <vm> --portable --out <bundle>
machinen restore <bundle> --json
```

## Supported semantic rows

These rows are supported as target-native materialization from `machinen.nodejs.memory-ir`.
Each retained product row records `detect -> capture -> decode -> classify -> materialize -> verify -> retain`.

| Row                                          | State     |
| -------------------------------------------- | --------- |
| `037-memory-real-plain-object`               | supported |
| `039-memory-real-closure-context`            | supported |
| `040-memory-real-string`                     | supported |
| `041-memory-real-nested-object-graph`        | supported |
| `042-memory-real-shared-references`          | supported |
| `043-memory-real-cycle`                      | supported |
| `044-memory-real-map-set`                    | supported |
| `045-memory-real-class-instance`             | supported |
| `046-memory-real-buffer`                     | supported |
| `047-memory-real-typed-array`                | supported |
| `048-memory-real-http-handler-closure-state` | supported |
| `050-memory-real-date-regexp`                | supported |
| `051-memory-real-error-object`               | supported |
| `052-memory-real-url-searchparams`           | supported |
| `053-memory-real-bigint-rich-graph`          | supported |
| `054-memory-real-module-singleton-state`     | supported |
| `055-memory-real-arraybuffer-dataview`       | supported |
| `056-memory-real-symbol-keyed-object`        | supported |
| `057-memory-real-eventemitter-listeners`     | supported |
| `058-memory-real-in-memory-lru-cache`        | supported |
| `059-memory-real-queue-state`                | supported |

## Refused live/opaque rows

These states are refused fail-closed by the portable VM product plan or by the broader compatibility matrix until separately proven. Rows `063` through `312` add 108 supported semantic Memory IR rows and 142 additional fail-closed rows. Sixteen formerly refused rows are now verified only through retained semantic Node Resource IR product proof (timer schedules, immediate/unref timers, drained streams/pipelines, TTL/cache expiration, timer-backed refill, reopenable file/stream specs, signal-handler registry). The remaining unsafe rows are `verified-refusal`: they have retained fail-closed proof and still are not supported as raw/live/native continuation.

| State               | Refusal code                                              |
| ------------------- | --------------------------------------------------------- |
| Pending Promise     | `node-portability-memory-pending-promise-unsupported`     |
| Pending microtask   | `node-portability-memory-pending-microtask-unsupported`   |
| Active socket       | `node-portability-memory-active-socket-unsupported`       |
| Active request      | `node-portability-memory-active-request-unsupported`      |
| Worker              | `node-portability-memory-worker-unsupported`              |
| Native addon        | `node-portability-memory-native-addon-unsupported`        |
| Child process       | `node-portability-memory-child-process-unsupported`       |
| Opaque native state | `node-portability-memory-opaque-native-state-unsupported` |
| Raw V8 state        | `node-portability-memory-raw-v8-state-unsupported`        |
| WeakMap             | `node-portability-memory-weakmap-unsupported`             |
| Active timer        | `node-portability-memory-timer-unsupported`               |
| Stream state        | `node-portability-memory-stream-unsupported`              |

The compatibility dashboard now includes 250 additional rows covering async context, object mechanics, GC/weak references, module state, timers, streams, crypto/native state, web APIs, Intl objects, advanced collections, process handles, workers, network handles, Promise/microtask state, serialization, symbols, RegExp/Date/time, diagnostics, compression, VM/WASM, CLI/job/session/rate-limit/observability state, and unknown/opaque hardening. Reconstructable semantic rows materialize through product-owned Node Memory IR or Resource IR in both `arm64 -> amd64` and `amd64 -> arm64` product smokes; unsafe live/native/opaque rows retain stable `node-portability-memory-*-unsupported` verified-refusal evidence.

## Node Resource IR product layer

Resource/runtime state is not treated as Memory IR. Product portable VM snapshots may carry a separate `nodejs-resource-ir.json` plus `nodejs-resource-inventory.json` and `nodejs-resource-classification.json`. Resource IR requires a paused source-VM capture boundary (`captureBoundary.sourceVmPauseRequired: true`, `stabilityPoint: source-vm-paused`) so semantic resource evidence is tied to a stable point. The product `machinen snapshot <vm> --portable --out <bundle>` path now records `portable-vm-pause-boundary.json` after the VMM writes a native `SIGUSR1`/`SIGUSR2` marker with `vcpusStopped: true`; failure to observe that boundary refuses the snapshot. Restore injects `nodejs-resource-materializer.mjs` only after validating that every row has row-level pause evidence and is a target-native semantic resource spec with no raw file descriptors, native/libuv handles, TLS session bytes, PIDs, V8 heap bytes, CPU state, or source-ISA emulation.

First supported Resource IR rows are proven in both `arm64 -> amd64` and `amd64 -> arm64` product smokes:

| Resource row                                 | Strategy                                          |
| -------------------------------------------- | ------------------------------------------------- |
| `nodejs-resource-timer-schedule`             | Recreate a target-native timer schedule spec      |
| `nodejs-resource-reopenable-file`            | Reopen a declared file path target-native         |
| `nodejs-resource-http-listener-route`        | Recreate declared listener/route semantics        |
| `nodejs-resource-drained-stream-buffer`      | Materialize drained/empty stream byte state       |
| `nodejs-resource-route-registry`             | Re-register declared route table semantics        |
| `nodejs-resource-middleware-registry`        | Re-register declared middleware order             |
| `nodejs-resource-configured-outbound-client` | Retain config-only outbound client semantics      |
| `nodejs-resource-signal-handler-registry`    | Reinstall declared target-native signal handlers  |
| `nodejs-resource-immediate-schedule`         | Enqueue a target-native immediate callback spec   |
| `nodejs-resource-unref-timer-schedule`       | Recreate an unref timer schedule spec             |
| `nodejs-resource-ttl-cache-expiration`       | Recompute declared TTL cache expiration semantics |
| `nodejs-resource-cache-expiration-timer`     | Restart a declared cache expiration timer         |
| `nodejs-resource-timer-backed-refill`        | Recreate timer-backed refill policy semantics     |
| `nodejs-resource-drained-readable-stream`    | Materialize an ended/drained readable stream      |
| `nodejs-resource-drained-writable-stream`    | Materialize a finished/drained writable stream    |
| `nodejs-resource-pipeline-drained-state`     | Materialize a drained pipeline state              |
| `nodejs-resource-reopenable-read-stream`     | Reopen a declared read stream target-native       |
| `nodejs-resource-reopenable-write-stream`    | Reopen a declared write stream target-native      |

Pausing freezes live/native state; it does not make that state portable. Unsupported live/native resource state observed at a paused boundary stays fail-closed with resource-specific codes:

| Runtime state            | Refusal code                                              |
| ------------------------ | --------------------------------------------------------- |
| Active timer handle      | `node-portability-resource-active-timer-unsupported`      |
| Raw native/libuv handle  | `node-portability-resource-native-handle-unsupported`     |
| Active TLS/session state | `node-portability-resource-active-tls-unsupported`        |
| Worker live state        | `node-portability-resource-worker-live-state-unsupported` |
| Missing pause proof      | `node-portability-resource-pause-boundary-missing`        |

Restore JSON groups Node refusals under `workloads.nodejs.refusals[]`, memory-specific codes under `workloads.nodejs.memoryRefusals[]`, and resource-specific codes under `workloads.nodejs.resourceRefusals[]`.

## Non-claims

This compatibility subset does not claim arbitrary Node process restore, raw V8 heap restore, same-PID continuation, arbitrary Linux process restore, raw CPU/vCPU/device replay, or source ISA emulation.
