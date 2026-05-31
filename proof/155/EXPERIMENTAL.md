# Broad Node Level 5 80% readiness audit

This document is proof-only. It does not claim product support.

After Proofs 126–154, the readiness matrix estimates Broad Node Level 5 support at **80%** for an exact candidate subset:

- Node 22 / V8 12 pointer-compressed builds.
- Idle event-loop state only.
- Selected V8 heap families: strings, arrays, plain objects, and closure contexts.
- Selected libuv/resource families: timers, TCP listeners, pipes, stdio, and readonly files.
- Bidirectional cross-architecture translated continuation lanes.

Still unsupported: worker threads, active requests, pending microtasks, external memory, Wasm modules, native addons, custom signal handlers, arbitrary processes, and raw CPU restore.

The support matrix remains `candidate-not-supported`.
