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

These states are refused fail-closed by the portable VM product plan or by the broader compatibility matrix until separately proven. Rows `063` through `312` intentionally expand coverage as refusal rows, not support rows.

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

The compatibility dashboard now includes 250 additional fail-closed rows covering async context, object mechanics, GC/weak references, module state, timers, streams, crypto/native state, web APIs, Intl objects, advanced collections, process handles, workers, network handles, Promise/microtask state, serialization, symbols, RegExp/Date/time, diagnostics, compression, VM/WASM, CLI/job/session/rate-limit/observability state, and unknown/opaque hardening. Each row has a stable `node-portability-memory-*-unsupported` code and retained refusal evidence.

Restore JSON groups Node refusals under `workloads.nodejs.refusals[]` and memory-specific codes under `workloads.nodejs.memoryRefusals[]`.

## Non-claims

This compatibility subset does not claim arbitrary Node process restore, raw V8 heap restore, same-PID continuation, arbitrary Linux process restore, raw CPU/vCPU/device replay, or source ISA emulation.
