# Runtime-neutral adapter boundary

Runtime adapters may describe portable semantic state. They must not weaken the
native-transparent success contract: no source-ISA execution, runtime sidecar,
application hook, or source text replay may be the success path.

An adapter document contains:

- runtime/build identity: runtime name, version, build id, target arch, module
  identity, and target-native binary provenance;
- portable semantic state sections: heap graph, pending timers, async
  continuations, module/build identity, native resource references,
  worker/thread state, and opaque extension state;
- native resource requirements: app-neutral capabilities required from the
  support envelope before restore can be attempted;
- target-native restore requirements: target runtime availability, target gates,
  executable provenance, and verifier evidence;
- refusal cases for every opaque or unsafe state class.

Mandatory refusal cases:

- unknown native addon/extension state;
- active target-opaque VM/JIT frames;
- source-owned executable/JIT code;
- active sockets without a transport contract;
- worker threads without a synchronization model;
- app hooks required for correctness.

The no-op fixture
[`runtime-adapter-noop-fixture.json`](./runtime-adapter-noop-fixture.json) proves
schema and refusal behavior without claiming support for any real runtime:

```sh
pnpm --silent runtime-adapter-fixture
```

A future Node/Python/Go/JVM/Ruby track should first map runtime state to the
app-neutral capabilities in
[`support-envelope.md`](./support-envelope.md). Only after the required
capabilities have target-native restore recipes, gates, positive profiles, nearby
negative profiles, docs, and validation timings can that runtime claim support.
