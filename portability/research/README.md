# Cross-Architecture Continuation Research Track

This is a research track, separate from the product Node semantic reconstruction path.

The product path reconstructs workload behavior from semantic Memory IR and Resource IR. It does **not** claim raw process continuation, raw V8 heap restore, source-ISA emulation, same-PID continuation, or arbitrary Linux process restore.

The research path explores whether selected workloads can be continued across architectures by translating live execution state into target-native execution state.

## Shared research host

Researchers may use `192.168.0.8` as the shared research host for cross-architecture capture, restore, verification, and retained evidence work.

## Track files

Each research track has its own file. Each track should also create and use a dedicated git worktree so parallel research does not share one checkout:

- [Track A: Native cross-architecture continuation substrate](track-a-native-cross-architecture-continuation-substrate.md)
- [Track B: Runtime safe-point adapters](track-b-runtime-safe-point-adapters.md)
- [Track C: Emulation comparison](track-c-emulation-comparison.md)

## Research claim shape

A defensible first claim is:

> Machinen experimentally continues selected cross-architecture native workloads at declared safe points using target-native reconstruction of register, stack, heap, and regular-file state.

This is **not**:

- arbitrary VM restore
- arbitrary Linux process restore
- arbitrary Node.js process restore
- raw VM/vCPU/device replay
- source-ISA emulation
- metadata-only success

## Node/V8 path

Node/V8 should not be first. It needs the native substrate plus runtime-specific knowledge:

- V8 heap layouts
- V8 stack/frame layouts
- JIT code and inline caches
- Node C++ object state
- libuv handles
- async queues and microtasks
- native addon boundaries
- GC metadata

A realistic first Node research claim would be:

> Selected Node/V8 workloads can continue at explicit JS/V8 safe points by exporting safe semantic state and re-entering target-native code, while refusing raw V8 stack, raw heap, native handles, active requests, and source-ISA execution.

That is still not arbitrary Node process continuation.

## Product boundary

This research track must not weaken product claims.

The product matrix should continue to say:

- arbitrary Linux process restore: `0`
- cross-architecture whole VM restore means workload reconstruction, not raw VM replay
- Node support means semantic target-native reconstruction unless separately marked experimental
- source-ISA emulation is not target-native portability
- metadata-only success is forbidden

Research proofs may exist, but they must be labeled as experimental harness proofs until they have product-owned retained evidence and fail-closed refusal coverage.

## End-to-end implementation lanes

Each lane should be self-contained: implementation, fixture, source capture, target restore, verifier, refusal cases, docs, tests, retained report, and claim guard. Put all lane artifacts under `portability/research/<lane>/`, not under `proofs/`.

### Lane 1: Native scalar safe-point E2E

Implemented in [`portability/research/cross-arch-native-safepoint-scalar/`](cross-arch-native-safepoint-scalar/).

Scope:

- C fixture
- scalar state only
- `arm64 -> amd64` and `amd64 -> arm64`
- target-native re-entry
- no stack/register translation yet
- retained report
- tests and docs

Track: [Track A](track-a-native-cross-architecture-continuation-substrate.md)

Additional Track A CPU/memory/final-jump proof: [`portability/research/cross-arch-native-cpu-memory-final-jump/`](cross-arch-native-cpu-memory-final-jump/).

Track A native binary proof matrix: [`portability/research/native-binary-refusals/`](native-binary-refusals/). Additional retained simple-shape proofs: [`portability/research/native-binary-shape-proofs/`](native-binary-shape-proofs/). Real `/usr/bin/less` detector lane: [`portability/research/real-less-detector/`](real-less-detector/). Real `/usr/bin/less` same-arch resume lane: [`portability/research/real-less-same-arch-resume/`](real-less-same-arch-resume/). Real `/usr/bin/less` bidirectional cross-arch marker continuation lane: [`portability/research/real-less-cross-arch-marker-continuation/`](real-less-cross-arch-marker-continuation/). Real unmodified `/usr/bin/less` safe-point inference lane: [`portability/research/real-less-unmodified-safe-point-inference/`](real-less-unmodified-safe-point-inference/). Marker/unmodified equivalence lane: [`portability/research/real-less-marker-unmodified-equivalence/`](real-less-marker-unmodified-equivalence/). Unmodified cross-arch continuation lane: [`portability/research/real-less-unmodified-cross-arch-continuation/`](real-less-unmodified-cross-arch-continuation/). Broad unmodified key-matrix experiment: [`portability/research/real-less-unmodified-key-matrix/`](real-less-unmodified-key-matrix/). Real unmodified `/usr/bin/more` poll/ppoll pty continuation lane: [`portability/research/real-more-unmodified-cross-arch-continuation/`](real-more-unmodified-cross-arch-continuation/). Grouped pager/watcher ladder: [`portability/research/real-pager-and-watcher-binary-ladder/`](real-pager-and-watcher-binary-ladder/). Stateful pager/watcher ladder: [`portability/research/real-pager-and-watcher-stateful-ladder/`](real-pager-and-watcher-stateful-ladder/). Pipeline/supervisor ladder: [`portability/research/real-pipeline-and-supervisor-ladder/`](real-pipeline-and-supervisor-ladder/). Socket resource ladder: [`portability/research/real-socket-resource-ladder/`](real-socket-resource-ladder/). Resource state batch ladder: [`portability/research/real-resource-state-batch-ladder/`](real-resource-state-batch-ladder/). Crazy binary stress ladder: [`portability/research/real-crazy-binary-stress-ladder/`](real-crazy-binary-stress-ladder/). Native continuation classifier: [`portability/research/native-continuation-classifier/`](native-continuation-classifier/). Native continuation shape matrix: [`portability/research/native-continuation-shape-matrix/`](native-continuation-shape-matrix/). Native continuation materializer: [`portability/research/native-continuation-materializer/`](native-continuation-materializer/). Native continuation capture-to-materialize: [`portability/research/native-continuation-capture-to-materialize/`](native-continuation-capture-to-materialize/). Native continuation CLI: [`portability/research/native-continuation-cli/`](native-continuation-cli/). First-class app adapters: [`portability/research/native-continuation-app-adapters/`](native-continuation-app-adapters/). Product-shaped native CLI contract: [`portability/research/native-continuation-product-cli/`](native-continuation-product-cli/). Real Node.js/PostgreSQL/Redis ladder: [`portability/research/real-node-postgres-continuation-ladder/`](real-node-postgres-continuation-ladder/).

### Lane 2: Native heap/pointer safe-point E2E

Implement `portability/research/cross-arch-native-safepoint-heap/`.

Scope:

- declared heap region
- nested struct/array
- pointer relocation table
- both directions
- refusal for undeclared pointer
- retained report, tests, and docs

Track: [Track A](track-a-native-cross-architecture-continuation-substrate.md)

### Lane 3: Native regular-file resource E2E

Implement `portability/research/cross-arch-native-safepoint-file/`.

Scope:

- regular file descriptor descriptor
- source offset capture
- target reopen/seek
- append/read verifier
- refusal for socket/pipe/unknown fd
- both directions
- retained report, tests, and docs

Track: [Track A](track-a-native-cross-architecture-continuation-substrate.md)

### Lane 4: Refusal hardening E2E

Implement `portability/research/cross-arch-continuation-refusals/`.

Scope:

- active syscall
- threads
- sockets
- missing safe point
- source-ISA emulation
- metadata-only success
- unsupported stack frame
- unsupported runtime/native handle
- retained refusal matrix
- tests and docs

Track: [Track A](track-a-native-cross-architecture-continuation-substrate.md)

### Lane 5: Python interpreter-frame E2E

Implement `portability/research/python-frame-safepoint-continuation/`.

Scope:

- explicit Python safe point
- capture module/function/local variables
- target re-entry
- both directions
- refusal for active generator/coroutine/native extension
- retained report, tests, and docs

Track: [Track B](track-b-runtime-safe-point-adapters.md)

### Lane 6: Node/V8 explicit safe-point E2E

Implement `portability/research/node-explicit-safepoint-continuation/`.

Scope:

- explicit JS safe point
- capture function/module/state payload
- target-native re-entry
- no raw V8 stack/heap
- both directions
- refusal for active promise/native handle/raw heap
- retained report, tests, and docs

Track: [Track B](track-b-runtime-safe-point-adapters.md)

Recommended order:

1. Native scalar safe point
2. Refusal hardening
3. Native heap/pointer safe point
4. Native regular-file resource
5. Python interpreter frame
6. Node/V8 explicit safe point
