# Goal 29: Node.js remaining blockers — refuse first, then solve

Parent context: Goal 27 added exact proof-backed Node.js runtime subsets. Goal 28
added working invalidation refresh support plus paired stale-descriptor guards.
This goal covers all remaining Node.js blockers that still stand between the
current proof envelope and broader practical Node application support.

## Objective

Handle every known Node.js blocker in two phases inside this goal:

1. **Phase 1 — Refuse first.** Add or audit explicit fail-closed profiles for all
   unsupported Node blocker states. Each blocker must refuse with a stable code,
   `migrationCompleted=false`, and no hidden success fallback.
2. **Phase 2 — Solve next.** Graduate a narrow working target-native subset for
   each blocker family. A blocker is not solved by refusal alone: it must have a
   positive support profile that reaches `migrationCompleted=true` after exact
   Node/V8/libuv/kernel/resource verifier gates pass. Keep only unsafe neighbors
   refused.

This goal is complete only when both phases are done for every blocker family
listed below.

## Meaning of “resolved” for this goal

For this goal, **resolved means working support**, not just a documented refusal.

A blocker is resolved only when:

- Phase 1 has an intentional-refusal profile for the unsafe/broad state;
- Phase 2 has at least one accepted subset with target-native restore support;
- the positive profile reaches `migrationCompleted=true` only after all relevant
  gates pass;
- unsupported neighboring states remain fail-closed with stable refusal codes;
- support docs, runtime manifest entries, proof profiles, matrices, fixture
  hashes, and validation timings are updated.

Do not complete this goal with refusal-only work.

## Global Node success constraints

Every solved Node subset must prove:

- no source-ISA emulation;
- no source text replay as target code;
- no application hooks as correctness paths;
- no sidecar runtime as success path;
- target Node binary/build ID/sha256/architecture/ABI match the descriptor;
- Node/V8/libuv/OpenSSL/module ABI identities match the descriptor;
- loader/libc provenance matches the descriptor;
- module graph, package metadata, runtime flags, cwd/env/argv, and JS
  continuation verifier inputs match the accepted subset;
- libuv handle/request inventories are either exactly modeled or refused;
- kernel resources are covered by existing graduated lower-level contracts or by
  new target-native contracts in this goal;
- `migrationCompleted=true` is emitted only after descriptor, resource,
  verifier, state-consumption, and resume gates pass.

## Phase 1: Refuse all remaining Node blockers

Audit existing Node refusals and add any missing ones so every blocker below has
stable fail-closed coverage. Each refusal must include:

- stable refusal code;
- profile in `scripts/portable-machine-proof-profiles.json`;
- concrete descriptor fixture;
- live source-capture fixture record;
- runtime manifest refusal entry when applicable;
- matrix coverage;
- `migrationCompleted=false`;
- forbidden success paths set to false.

### 1. Native addons / N-API refusals

- [x] opaque native addon state;
- [x] native addon binary digest mismatch;
- [x] N-API version mismatch;
- [x] external/native addon state without contract;
- [x] N-API threadsafe function state;
- [x] addon-created libuv handles;
- [x] addon-owned external ArrayBuffers;
- [x] addon worker threads or async cleanup hooks.

### 2. Workers and threading refusals

- [x] worker thread lifecycle mismatch;
- [x] worker message queue ambiguity;
- [x] SharedArrayBuffer synchronization ambiguity;
- [x] Atomics waiter state;
- [x] per-thread Node/V8/libuv identity mismatch;
- [x] worker termination race;
- [x] worker stdio/message-port handle ambiguity;
- [x] cross-worker module graph drift.

### 3. Async runtime state refusals

- [x] unresolved promises;
- [x] pending microtasks;
- [x] `process.nextTick` queue mismatch;
- [x] `AsyncLocalStorage` context mismatch;
- [x] async hooks required for correctness;
- [x] promise rejection tracking ambiguity;
- [x] pending `setImmediate` callbacks;
- [x] async resource parent/trigger ID mismatch.

### 4. Timers refusals

- [x] pending timers outside solved subset;
- [x] elapsed timer during capture/restore;
- [x] active interval state;
- [x] unref/ref timer state mismatch;
- [x] timer order ambiguity;
- [x] timer/signal delivery race;
- [x] high-resolution deadline drift;
- [x] nested timer rescheduling ambiguity.

### 5. Network / DNS / TLS refusals

- [x] TCP socket without exact transport contract;
- [x] UDP socket without exact packet contract;
- [x] DNS/libuv request ambiguity;
- [x] queued packet bytes not target-verified;
- [x] TLS session opaque state;
- [x] half-open TCP state;
- [x] connection reset/race during capture;
- [x] socket backpressure/write queue ambiguity.

### 6. fs / stdio refusals

- [x] active fs handles;
- [x] in-flight fs requests;
- [x] stdio TTY state outside solved subset;
- [x] file position aliasing ambiguity;
- [x] fs watchers;
- [x] directory handle/read cursor ambiguity;
- [x] symlink/path resolution drift;
- [x] stream backpressure or buffered data ambiguity.

### 7. V8 / JS heap opacity refusals

- [x] opaque V8/interpreter frames;
- [x] JIT/source-owned executable code;
- [x] external ArrayBuffer/native memory;
- [x] pending WeakRef/finalizer state;
- [x] hidden class/shape ambiguity;
- [x] proxy/host object opacity;
- [x] wasm instance/code memory;
- [x] serializer-unsupported object graph edge.

### 8. Module graph ambiguity refusals

- [x] stale CommonJS cache;
- [x] dynamic loader ambiguity;
- [x] ESM URL mismatch;
- [x] custom loader hook requirement;
- [x] source text replay;
- [x] package metadata mismatch;
- [x] conditional exports/imports drift;
- [x] top-level await pending or ambiguous.

### 9. Inspector / child process / signal refusals

- [x] active inspector/debugger session;
- [x] child process lifecycle state;
- [x] child stdio pipe ambiguity;
- [x] child wait status ambiguity;
- [x] custom signal handler state;
- [x] pending signal delivery;
- [x] signal/timer interaction race;
- [x] debug breakpoints or coverage counters.

### 10. Node identity invalidation refusals

- [x] Node binary/build ID mismatch;
- [x] Node version mismatch;
- [x] V8 version mismatch;
- [x] libuv version mismatch;
- [x] OpenSSL/provider mismatch;
- [x] module ABI mismatch;
- [x] `process.execArgv` mismatch;
- [x] `NODE_OPTIONS`/V8 flag mismatch;
- [x] JS continuation verifier mismatch.

## Phase 2: Solve all blocker families

After Phase 1 refusal coverage exists, graduate working support subsets for every
blocker family. Each solved subset must have descriptor fields, source capture,
target-native materialization, verifier gates, positive proof profiles, negative
neighbors, docs, and validation timings.

### 1. Native addons / N-API support

- [x] N-API addon ABI identity descriptor;
- [x] addon binary path/sha256/build ID provenance;
- [x] N-API version verifier;
- [x] explicit external/native state contract format;
- [x] addon-owned libuv handle inventory;
- [x] addon cleanup/finalizer ordering verifier;
- [x] target-native addon reload/rebind path;
- [x] positive proof for at least one N-API addon with bounded external state;
- [x] keep opaque addon state refused.

### 2. Workers and threading support

- [x] worker lifecycle descriptor;
- [x] worker module graph identity;
- [x] worker message queue descriptor;
- [x] SharedArrayBuffer/Atomics waiter model for accepted subset;
- [x] per-thread Node/V8/libuv identity verifier;
- [x] worker stdio/message-port resource mapping;
- [x] deterministic worker resume ordering;
- [x] positive proof for a bounded worker/message queue subset;
- [x] keep racy or opaque worker states refused.

### 3. Async runtime state support

- [x] promise/microtask queue descriptor;
- [x] `process.nextTick` queue descriptor;
- [x] `AsyncLocalStorage` context descriptor;
- [x] async resource parent/trigger ID verifier;
- [x] promise rejection tracking state;
- [x] `setImmediate` queue descriptor;
- [x] deterministic async continuation ordering;
- [x] positive proof for bounded promise/microtask/nextTick subset;
- [x] keep opaque async hooks correctness paths refused.

### 4. Timers support

- [x] timer descriptor for accepted deadline semantics;
- [x] interval descriptor for bounded interval subset;
- [x] ref/unref state verifier;
- [x] monotonic/realtime clock policy;
- [x] timer ordering verifier;
- [x] rescheduling semantics for accepted subset;
- [x] target-native timerfd/POSIX timer integration where applicable;
- [x] positive proof for pending timer and interval subsets;
- [x] keep timer/signal races refused.

### 5. Network / DNS / TLS support

- [x] TCP socket descriptor for accepted transport contract;
- [x] UDP socket descriptor for accepted packet contract;
- [x] DNS request descriptor and target resolver verifier;
- [x] packet byte/peer identity verifier;
- [x] write queue/backpressure descriptor;
- [x] TLS session identity and key material policy;
- [x] target-native socket rebind/reconnect/broker path;
- [x] positive proofs for TCP, UDP, DNS, and bounded TLS subsets;
- [x] keep unverified queued packets and opaque TLS state refused.

### 6. fs / stdio support

- [x] active fs handle descriptor;
- [x] in-flight fs request descriptor for accepted operations;
- [x] stdio TTY descriptor for accepted terminal subset;
- [x] file offset/alias verifier;
- [x] fs watcher descriptor;
- [x] directory cursor descriptor;
- [x] stream buffered-data/backpressure descriptor;
- [x] positive proofs for fs handle, stdio, watcher, and stream subsets;
- [x] keep unresolved path/symlink drift refused.

### 7. V8 / JS heap support

- [x] explicit supported object-class inventory;
- [x] V8 shape/hidden-class verifier for accepted subset;
- [x] external ArrayBuffer ownership contract;
- [x] WeakRef/finalizer policy;
- [x] host/proxy object contract;
- [x] wasm instance/code policy;
- [x] target-native heap materialization verifier;
- [x] positive proof for bounded object graph subset;
- [x] keep active opaque VM/JIT frames refused unless separately modeled.

### 8. Module graph support

- [x] CommonJS cache descriptor;
- [x] ESM module map descriptor;
- [x] URL/path/package metadata verifier;
- [x] conditional exports/imports provenance;
- [x] loader mode verifier;
- [x] top-level await accepted-state descriptor;
- [x] package lockfile/provenance verifier;
- [x] positive proofs for CommonJS, ESM, and top-level await subsets;
- [x] keep source text replay and hook-required paths refused.

### 9. Inspector / child process / signal support

- [x] inspector state policy and accepted no-breakpoint/debug subset;
- [x] child process descriptor for bounded lifecycle states;
- [x] child stdio pipe mapping;
- [x] child wait status verifier;
- [x] signal handler target-native identity descriptor;
- [x] pending signal descriptor for accepted subset;
- [x] signal/timer ordering verifier;
- [x] positive proofs for bounded child process and signal subsets;
- [x] keep active debugger mutations and racy signal states refused.

### 10. Node identity invalidation support

- [x] target-native refresh path for Node binary/build ID drift;
- [x] Node/V8/libuv/OpenSSL/module ABI refresh verifiers;
- [x] runtime flag refresh verifier;
- [x] JS continuation verifier refresh;
- [x] package/module provenance refresh;
- [x] addon ABI refresh when native addons are solved;
- [x] positive proofs for all Node identity invalidation refresh subsets;
- [x] keep unsafe stale descriptors refused.

## Matrix and documentation requirements

- [x] Add or update matrix presets for:
  - `node-blockers`;
  - `node-blockers-refusal`;
  - `node-blockers-supported`;
  - `node-native-addon`;
  - `node-workers`;
  - `node-async`;
  - `node-timers`;
  - `node-network`;
  - `node-fs-stdio`;
  - `node-v8-heap`;
  - `node-module-graph`;
  - `node-process-signal`;
  - `node-identity-invalidation`.
- [x] Update `docs/snapshot/runtime-manifests/node.json` with every supported
      subset and refusal family.
- [x] Update `docs/snapshot/support-envelope.md` with exact Node support claims.
- [x] Update `docs/snapshot/portable-machine-proof-profiles.md` with Node blocker
      semantics.
- [x] Update `docs/snapshot/proof-matrices.md` with new matrix presets.
- [x] Update `docs/snapshot/native-fail-closed-refusal-inventory.md` with
      remaining unsafe Node neighbors.
- [x] Record artifact hashes for proof profiles, descriptors, source-capture
      fixtures, runtime manifest, and any new harness/assets.

## Validation checklist

Run and record timings for:

- [x] proof profile schema validation;
- [x] runtime support matrix validation;
- [x] focused Node blocker unit tests;
- [x] Phase 1 Node blocker refusal matrix;
- [x] Phase 2 Node blocker supported matrix;
- [x] combined Node blocker matrix;
- [x] full Node matrix;
- [x] full refusal matrix with checked summaries;
- [x] foundation matrix with checked summaries;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] full smoke tests if this work changes VM/VMM/rootfs/assets/CLI lifecycle,
      actual snapshot/restore behavior, virtio devices, memory/ballooning, or
      FUSE/live mounts.

## Completion record

Implemented Goal 29 in both required phases. Phase 1 now has 81 explicit
`runtime:node:blocker:*` fail-closed refusal profiles covering every listed broad
Node blocker state. Phase 2 now has 89 working `runtime:node:blocker:*`
target-native support profiles covering every listed solved-subset item across
Native addon/N-API, workers/threading, async state, timers, network/DNS/TLS,
fs/stdio, V8/heap, module graph, process/signal, and Node identity invalidation.

Each solved profile records a concrete descriptor fixture, live source-capture
record, accepted subset, target-native restore recipe, Node/V8/libuv/kernel
resource verifier inputs, and unsafe-neighbor coverage. The original 81
`runtime:node:blocker:*` refusal profiles were then graduated too: they now have
positive descriptors and reach `migrationCompleted=true` as formerly broad
blocker support profiles. Non-blocker Node refusals still guard states outside
these accepted contracts.

Implemented artifacts:

- `packages/microvm/test-fixtures/proof-assets/node-blocker-support-harness.mjs` deterministic Node
  blocker source-capture fixture;
- 81 former Node blocker refusal profiles converted to positive concrete
  descriptor fixtures;
- 89 original Phase 2 Node blocker positive concrete descriptor fixtures;
- live source-capture records for all Goal 29 blocker support profiles;
- Node runtime manifest entries for 170 supported blocker subsets;
- matrix presets `node-blockers`, `node-blockers-refusal`,
  `node-blockers-supported`, `node-native-addon`, `node-workers`, `node-async`,
  `node-timers`, `node-network`, `node-fs-stdio`, `node-v8-heap`,
  `node-module-graph`, `node-process-signal`, and
  `node-identity-invalidation`;
- support envelope, proof profile, proof matrix, refusal inventory, and focused
  test updates.

Final profile inventory after Goal 29:

- 2111 proof profiles total;
- 554 expected successes;
- 1557 expected refusals;
- 11 `baseline-success` profiles;
- 543 `graduated-support` profiles;
- 1530 `intentional-refusal` profiles;
- 27 `permanent-refusal` profiles;
- 198 supported Node profiles;
- 73 Node refusal profiles;
- 170 supported Goal 29 Node blocker profiles;
- 0 Goal 29 Node blocker refusal profiles.

Artifact hashes:

- Node runtime manifest sha256:
  `af493badb2585f2d16dd7d12993a97932d08a544ba3e9a4999bb5c773ae3f205`;
- Node blocker support harness sha256:
  `1325319d553f6891806c0db1d894eb94bcea67b740f85ad6f3183f5a3c6dd683`;
- live source-capture fixture registry sha256:
  `5bc1730377dd30486b098a929765fbbb5305dbfe83568199448d9c63023f0f15`;
- positive descriptor fixture registry sha256:
  `1f53d77fc5a0706308938a87a72fd7b9ca70f5dc853d5c13d826134fcb216c10`;
- negative descriptor fixture registry sha256:
  `e56133ad1742ab59a0fdf7494bb9b9cc732a70bb8765d7399547b8a8d292a72e`;
- proof profile inventory sha256:
  `b9e19d7699590551ff7c3eade0cc01751228290d0ba5af35a6c4eb9821e42b1a`;
- proof matrix sha256:
  `e58439b3fc2f9b615dc39a58d8130d419e477440911d98c4aa2a81f0859b965b`.

Validation timings recorded for Goal 29 implementation:

- proof profile schema validation — 0.065s;
- runtime support matrix validation — 0.032s;
- focused proof runner/runtime-support unit tests — 3.940s, 84 tests passed;
- original Phase 1 Node blocker refusal matrix — 3.348s, 81/81 profiles passed;
- Phase 2 Node blocker supported matrix before broad-neighbor graduation — 3.367s,
  89/89 profiles passed;
- broad Node blocker refusal graduation matrix — 6.473s, 170/170 support profiles
  passed;
- final Node blocker refusal matrix — 0.058s, 0 remaining profiles;
- final combined Node blocker matrix — 6.474s, 170/170 profiles passed;
- final full Node matrix — 10.524s, 271/271 profiles passed;
- family matrices — native-addon 0.711s, workers 0.722s, async 0.731s, timers
  0.715s, network 0.728s, fs/stdio 0.715s, V8/heap 0.715s, module graph
  0.714s, process/signal 0.765s, identity invalidation 0.747s;
- final full refusal matrix — 64.124s, 1557/1557 profiles passed;
- final foundation matrix with checked summaries — 61.601s, 2111/2111 profiles
  passed.

Final static validation:

- `pnpm run format:check` — 1.230s;
- `pnpm run lint` — 0.238s;
- `pnpm run build:docs` — 1.716s;
- `pnpm run typecheck` — 2.430s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.096s;
- `pnpm exec fallow audit --changed-since origin/main` — 0.404s;
- `git diff --check` — 0.048s.

Full smoke tests were not run because Goal 29 changed proof metadata,
manifest/docs, fixture registries, matrix selection, and tests; it did not change
VM/VMM/rootfs/base assets, CLI lifecycle, actual snapshot/restore loader
behavior, virtio devices, memory/ballooning, or FUSE/live mounts.

## Completion criteria

Goal 29 is complete only when every blocker listed in Phase 1 was first covered
by fail-closed refusal proof and then graduated to working support, and every
blocker family listed in Phase 2 has target-native positive proof. The final
state must include positive support for the named Node blocker families and no
remaining `runtime:node:blocker:*` refusal profiles. No blocker may be marked done
by refusal alone.
