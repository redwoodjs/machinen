# Portable machine support envelope

This is the app-neutral support contract for the current portable machine proof
ladder. A runtime or application is supported only when its live state can be
expressed as the capabilities below, restored with target-native recipes, and
verified by the target gates in the proof profile. Documentation alone never
makes a runtime/app family supported.

Current profile inventory:

- 11 `baseline-success` profiles;
- 626 `graduated-support` profiles;
- 1457 `intentional-refusal` profiles;
- 27 `permanent-refusal` profiles.

## Success contract

A positive proof is valid only when all of these are true:

- target-native completion on the amd64 guest;
- no source-ISA emulation;
- no Node/Bun/runtime sidecar as the success path;
- no application hooks;
- no captured source text reused as target code;
- `migrationCompleted=true` only after target-native completion and all required
  target gates pass;
- `descriptorGateCompleted=true` before completion;
- unsupported state refuses with a stable code and `migrationCompleted=false`.

## Accepted capability families today

The accepted capability map is recorded per profile in
[`scripts/portable-machine-proof-profiles.json`](../../scripts/portable-machine-proof-profiles.json)
under `capabilities`. The families currently covered are:

- regular files: active `read`, `pread64`, `readv`, `write`, `pwrite64`, and
  `writev`, plus one graduated duplicate-fd alias with shared open-file
  description semantics;
- pipe pairs: empty pipe pair recreation with a known open peer and no waiters,
  plus `pipe-buffered-bytes-v1-open-peer-no-waiters-bounded-payload` for one
  bounded buffered payload with exact byte verification;
- eventfd/timerfd: non-semaphore eventfd counter recreation, the
  `eventfd-counter-alias-v1-two-fds-nonsemaphore-no-waiters` subset for two fds
  sharing one target-owned eventfd open-file description, and disarmed or
  relative one-shot timerfd descriptor recreation;
- readiness wait: one level-triggered `poll`/readiness proof for recreated
  eventfd `POLLIN`;
- signal mask: blocked-mask-only signal state, with no pending delivery,
  alt-stack, active signal frame, or restart ambiguity;
- process context: bounded argv/env/cwd/auxv handoff and target-owned
  `AT_RANDOM`;
- private memory: one private anonymous writable non-executable data range,
  multiple private anonymous data ranges with guard-page verification, and the
  real `real-private-multi-range-file-recreate` arm64->amd64 workload proof;
- file-backed mappings: non-executable private mappings from target file identity
  plus dirty overlay bytes;
- TCP listeners: loopback listeners with no accepted or queued connections,
  including the real `real-tcp-listener-recreate` arm64->amd64 proof;
- active TCP streams: one plain stream only through an explicit audited transport
  broker, including the real `real-tcp-active-connection-transport-recreate`
  proof;
- readiness/epoll: listener readiness probes, including the real
  `real-tcp-listener-readiness-recreate` target-side probe proof, and acyclic
  level-triggered epoll graphs over accepted descriptors;
- raw ICMP: the narrow `raw-icmp-v1:loopback-echo-no-inflight` subset for one
  IPv4 raw ICMP loopback echo socket with `CAP_NET_RAW`, target-loopback route,
  empty in-flight/receive queues, and ICMP id/sequence verifier gates;
- ping sockets: the narrow `ping-socket-v1:loopback-echo-no-inflight` subset for
  one IPv4 Linux `SOCK_DGRAM`/`IPPROTO_ICMP` loopback echo socket authorized by
  target `ping_group_range` and uid/gid credential gates, including the non-root
  uid/gid `1000` proof; Goal 15 adds
  `ping-socket-v2:loopback-echo-active-recvmsg-empty-queue` for real distro
  `/usr/bin/ping` blocked in active `recvmsg` with an empty queue/no-in-flight
  target-native wait-preservation gate;
- synchronization: one private futex wait/wake, explicit rseq lifecycle, and one
  memfd shared-memory contract;
- threads: the controlled two-thread ppoll proof with target thread-spawn gates
  and deterministic wake gates for the futex subset;
- active syscalls: the active syscall completions named by the positive profiles,
  including deterministic `EINTR` for the accepted ppoll-timeout subset;
- Goal 21-26 graduations: 249 additional narrow `goal21:*`/`goal26:*`
  target-native subsets for UDP queues, advisory locks, mappings, namespaces,
  scheduler/process controls, eventfd/timerfd/signalfd/signal/restart/futex/rseq,
  SysV/POSIX IPC, TTY/PTY state, TCP/raw-ICMP/ping/ICMPv6 packet contracts,
  epoll/io-uring/inotify/fanotify states, and thread/TLS edges. Each positive
  profile has a live source-capture record plus concrete descriptor fixture that
  drives target-native success with descriptor, resource, verifier,
  state-consumption, and resume gates passing before `migrationCompleted=true`;
  each neighboring negative has a live source-capture record plus concrete
  descriptor fixture that drives target restore refusal with
  `migrationCompleted=false`.
- Goal 27 Node.js graduations: 11 exact `runtime:node:*` subsets for the empty
  event loop, CommonJS and ESM module graphs, simple JS heap state,
  promises/microtasks, timers, fs/stdio, TCP/UDP/DNS, crypto, workers, and native
  addons/N-API. These are not broad Node/V8/libuv support claims: every subset is
  proof-backed by Node binary/version/loader/module/event-loop/async-resource/JS
  continuation gates, while 56 Node negative neighbors remain fail-closed with
  `migrationCompleted=false`.
- Goal 28 invalidation support: 16 `invalidation:*` valid-baseline profiles, 67
  working target-native refresh profiles, and 67 stale-state refusal guards cover
  descriptor, live-capture artifact, runtime/loader/libc, module/package/file,
  process context, kernel resource, socket/packet/timer, and Node-specific
  identity drift. The refresh profiles detect drift, recapture target-native
  provenance, rewrite/revalidate the portable descriptor, and then reach
  `migrationCompleted=true`; the paired stale-descriptor guards keep unsafe
  originals fail-closed with stable `portable-*` codes.
- Goal 29 Node blocker support: 170 `runtime:node:blocker:*` target-native
  support profiles solve the remaining Native addon/N-API, worker/threading,
  async, timer, network/DNS/TLS, fs/stdio, V8/heap, module graph,
  process/signal, and Node identity-invalidation blocker families. The original
  81 broad/unsafe blocker refusal profiles were graduated to working support and
  now complete with `migrationCompleted=true`; broader non-blocker Node refusals
  still guard source-text replay, opaque JIT/VM frames, unverified sockets, and
  other unsupported states.
- Representative Node application support: 10 `runtime:node:app:*` proof-backed
  application harnesses now cover CLI, CommonJS, ESM, timers/async, fs/stdio,
  HTTP/TCP, UDP/DNS, worker, native-addon, and crypto/TLS workloads. These app
  profiles compose the proved Node runtime/blocker capabilities and complete with
  target-native `migrationCompleted=true`. Goal 31 guardrails require each Node
  app profile to use a `real-node-app:` fixture, app harness, target output
  verifier, checked summary, and `node-app-output` gate; schema validation fails
  if a Node app falls back to synthetic fields, source text replay, sidecars,
  app hooks, source-ISA emulation, missing fixtures, missing checked summaries,
  or missing smoke matrix coverage. Goal 32 adds a live cross-architecture Node
  app smoke that runs all ten fixtures from the local arm64 machine and the arm64
  remote builder, then validates target-native output on the Proxmox amd64 host
  with different source/target architecture evidence. Goal 34 extends the proof
  envelope to a production-shaped service with package/dependency/config
  provenance, HTTP routes, file writes, durable JSONL database/log state, real
  compiled `.node` addon provenance, active-connection refusal policy,
  repeatability evidence, artifact-level shortcut inspection, Node 20/22/24
  version coverage, and a documented user-facing workflow. Goal 35 adds the
  reverse amd64 -> arm64 route and expands the Node envelope with existing
  process discovery, a narrow active HTTP/TCP preservation subset, child
  process/IPC trees, inspector-state refusal policy, dirty persistent-state
  semantics, and broader native addon/ABI provenance. Goal 36 expands the proof
  envelope to complex framework-shaped apps, real persistence systems,
  WebSocket/TLS/keep-alive networking, cluster/worker/supervisor topology,
  published native package layouts, load/failure injection, and Node 18/20/22/24
  bidirectional OS/runtime/architecture coverage. Goal 37 adds audited
  third-party ecosystem-equivalent coverage without live third-party installs:
  local registry fixtures, native prebuild layout simulation, lockfile/SBOM
  provenance, no-network/no-scripts sandbox enforcement, and bidirectional
  Node 18/20/22/24 app restore. Goal 38 begins non-Node exploration with
  proof-or-refusal envelopes for JVM, Python, Ruby, and Go using audited local
  fixtures and target-native shortcut guards. Goal 39 hardens Python and Go with
  live bidirectional arm64/amd64 repeatability proofs. Goal 40 adds hard-state
  boundaries for active sockets/TLS, opaque native extensions, and arbitrary Go
  scheduler state: reconnect-only and bounded-quiescent subsets are supported,
  while opaque/ambiguous states remain stable refusals. Goal 42 expands Go
  support to quiesced HTTP service recreation, drained worker pools, drained
  channels, and deterministic timers with bidirectional arm64/amd64 proof. Goal
  43 proves PostgreSQL clean/quiesced logical restore bidirectionally across
  arm64 and amd64 with target-native PostgreSQL, while unsafe database states and
  physical data-directory cross-arch byte-copy remain stable refusals.
- Remaining Node refusal resolution: the 73 profiles that still carried
  `runtime:node:*` refusal capabilities were graduated to target-native support.
  The Node runtime manifest now has 0 `runtime:node:*` refusal profiles and 281
  supported Node profiles; non-Node permanent/system refusals remain outside the
  Node support claim.

## Refusal families that remain

Refusal profiles use `refusesCapabilities` and exact refusal codes. The remaining
unsafe families are:

- sockets and active TCP/network connections outside the Goal 8/9 listener,
  explicit-broker, Goal 12 raw-ICMP loopback, or Goal 13 ping-socket loopback
  contracts;
- raw ICMP outside `raw-icmp-v1`, including missing capability, wrong namespace,
  stale route, non-loopback destinations, in-flight/unread packet ambiguity,
  unsupported socket options, BPF filters, `IP_HDRINCL`, ICMPv6, or hidden
  source-side helpers;
- ping sockets outside `ping-socket-v1`/`ping-socket-v2`, including missing
  `ping_group_range` permission, wrong uid/gid/group provenance, raw-socket
  capability confusion, wrong namespace, stale route, non-loopback destinations,
  id/sequence mismatch, in-flight/unread packet ambiguity, unsupported options,
  BPF filters, ICMPv6, hidden source-side helpers, or active `recvmsg` shapes
  outside the empty-queue/no-in-flight distro ping contract; Goal 16/17 keep
  known in-flight, known unread reply, multi-interval sequence continuity,
  multiple in-flight/unread replies, mismatched id/sequence, ICMPv6, unknown
  queued packet bytes, unknown timestamp/TTL ancillary data, and ambiguous
  `ppoll`/`setitimer`/control-message states refused until exact packet/timer
  gates exist;
- futex/rseq and scheduler-visible synchronization outside the one-waiter,
  target-owned lifecycle contracts;
- shared memory without a target sharing contract;
- epoll wait graphs beyond the graduated acyclic level-triggered subsets;
- pending signals, active signal frames, alt-stacks, and ambiguous restarts;
- signal-mask-changing `ppoll`/wait semantics;
- native addons, JIT/self-modifying code, and opaque runtime state;
- source vDSO/vvar reuse and raw cross-ISA vmstate replay;
- Goal 18/20 master-audit broad-state refusals remain fail-closed except for the
  narrow Goal 21 target-native subsets recorded as `goal21:*` capabilities in
  the proof profile matrix. The still-refused broad neighbors include generic
  socket send/receive queues outside the exact UDP/TCP/ping/ICMP contracts,
  kqueue state, file locks/leases outside the single modeled advisory-lock
  handoff contracts, mmap dirty aliasing outside the explicit dirty-overlay
  descriptor contracts, huge/special mappings, general SIMD/FPU and
  architecture-specific register state, dynamic linker state outside the
  build-id/digest-gated executable-text subset, deleted/replaced executable
  mappings outside the content-addressed immutable-copy subset, ASLR-sensitive
  source pointers, signal-handler PC/stack states outside the deterministic
  target-native frame subset, thread join/TLS edge cases outside the modeled
  child/TLS-slot subsets, timer delivery ordering outside the exact timerfd
  count/periodic contracts, pipe/eventfd waiters or aliases outside the modeled
  Goal 21 subsets, namespace/routing provenance outside target-verified loopback
  routes, target next-packet verification gaps outside known packet contracts,
  stack/heap edge layouts, and vvar time-source reuse.

Readiness note: Goal 6 graduated blocked-mask-only signal support and one
level-triggered eventfd readiness proof. Signal-mask-changing `ppoll` or wait
semantics remain refused until they have their own verifier and deterministic
ordering/final-mask contract.

## Restore layers

- **Portable machine restore**: app-neutral machine/process capabilities are
  translated into target-native descriptors and verified inside the amd64 guest.
- **Native process restore**: user-process state is captured and represented as
  native process image documents. Unsupported kernel/runtime state must refuse.
- **Runtime-level state restore**: a runtime adapter may describe portable
  semantic state, but it is not success unless target-native restore and all
  gates complete without sidecars, hooks, emulation, or source text replay.
- **Application-specific hooks**: disallowed as a success path. If correctness
  needs an app hook, the profile must refuse.

## How to read a refusal

A refusal is passing behavior when it shows:

- the exact expected refusal code;
- `migrationCompleted=false`;
- `descriptorGateCompleted=false` when the descriptor cannot be safely accepted,
  or `descriptorGateCompleted=true` followed by a target verifier refusal for
  target-native permanent-refusal proofs;
- no source text replay, no source-ISA emulation, and no sidecar success path;
- no accidental target-native success.

Use this document with the profile capability fields to decide whether a new app
state is already supported, needs a support graduation, or must fail closed.
