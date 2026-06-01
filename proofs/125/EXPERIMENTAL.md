# Experimental Node Level 5 candidate subset

This document is proof-only. It does not claim product support.

The current candidate subset is narrow:

- Node 22 / V8 12 pointer-compressed builds.
- Idle event-loop state only.
- Selected strings, objects, arrays, and closure environments.
- Timers, TCP listeners, stdio, readonly files, and pipes.
- No worker threads, active requests, pending microtasks, custom signal handlers, external memory, Wasm modules, or raw CPU restore.

The readiness audit estimates broad Node Level 5 support at **50%** after Proofs 106–124. The support matrix remains `candidate-not-supported`.
