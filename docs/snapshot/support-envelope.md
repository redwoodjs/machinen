# Portable machine support envelope

This is the app-neutral support contract for the current portable machine proof
ladder. A runtime or application is supported only when its live state can be
expressed as the capabilities below, restored with target-native recipes, and
verified by the target gates in the proof profile. Documentation alone never
makes a runtime/app family supported.

Current profile inventory:

- 11 `baseline-success` profiles;
- 28 `graduated-support` profiles;
- 146 `intentional-refusal` profiles;
- 3 `permanent-refusal` profiles.

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
- pipe pairs: empty pipe pair recreation with a known open peer and no waiters;
- eventfd/timerfd: non-semaphore eventfd counter recreation and disarmed or
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
  including deterministic `EINTR` for the accepted ppoll-timeout subset.

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
  outside the empty-queue/no-in-flight distro ping contract; Goal 16 keeps
  known in-flight, known unread reply, multi-interval sequence continuity,
  multiple in-flight/unread replies, mismatched id/sequence, ICMPv6, and
  ambiguous timer/control-message states refused until exact packet/timer gates
  exist;
- futex/rseq and scheduler-visible synchronization outside the one-waiter,
  target-owned lifecycle contracts;
- shared memory without a target sharing contract;
- epoll wait graphs beyond the graduated acyclic level-triggered subsets;
- pending signals, active signal frames, alt-stacks, and ambiguous restarts;
- signal-mask-changing `ppoll`/wait semantics;
- native addons, JIT/self-modifying code, and opaque runtime state;
- source vDSO/vvar reuse and raw cross-ISA vmstate replay.

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
- `descriptorGateCompleted=false` when the descriptor cannot be safely accepted;
- no source text replay, no source-ISA emulation, and no sidecar success path;
- no accidental target-native success.

Use this document with the profile capability fields to decide whether a new app
state is already supported, needs a support graduation, or must fail closed.
