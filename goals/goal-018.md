# Goal 18: Master plan for near-complete portable snapshot/restore

Parent context:

- [`goal-016.md`](./goal-016.md) and [`goal-017.md`](./goal-017.md) kept
  distro ping packet/timer states fail-closed until exact packet/timer verifier
  gates exist.
- The current support envelope proves selected target-native continuations, but
  many general workloads still contain kernel-owned, scheduler-visible,
  memory-provenance, signal, CPU, or executable state that cannot safely be
  recreated by approximation.

## Objective

Define and execute the multi-track roadmap required to move portable
snapshot/restore toward broad, app-neutral coverage. Success requires explicit
portable descriptor models, target-native restore recipes, target verifier gates,
positive real-workload proofs, and fail-closed negative matrices for every newly
supported state family.

This is a master goal. It should be completed by landing smaller child goals, not
by weakening support definitions or claiming broad restore from documentation.

## Core principle

Do not recreate “something similar.” For every supported state family, prove that
the target-visible state is either:

1. exactly equivalent to the source state under a documented portable contract;
   or
2. intentionally target-owned with an explicit semantic contract and verifier
   gate.

Unsupported neighboring states must refuse with stable codes and
`migrationCompleted=false`.

## Track 1: Kernel-visible state models

Most remaining hard cases are resources whose truth lives in the kernel. Add
portable descriptors and target verifier gates for:

- [ ] sockets with receive queues, send queues, and in-flight packets;
- [ ] TCP established connections;
- [ ] UDP sockets and datagram queues;
- [ ] epoll/kqueue readiness lists and edge/oneshot semantics;
- [ ] futex wait ownership and robust-list state;
- [ ] rseq registration and restart/lifecycle state;
- [ ] pending signals and active signal frames;
- [ ] timers with exact delivery order;
- [ ] pipes/eventfds with aliases, buffered data, counters, and waiters;
- [ ] shared memory mappings;
- [ ] file locks, leases, and mmap dirtiness.

Required per family:

- descriptor schema;
- source capture model;
- target-native recipe;
- verifier gates;
- positive proof;
- negative neighboring-state matrix;
- documentation of accepted subset and refusal envelope.

## Track 2: Packet/network continuation

For ping, TCP, UDP, and future network families, define exact network state
contracts for:

- [ ] packet queues;
- [ ] in-flight packets;
- [ ] sequence numbers;
- [ ] peer identity;
- [ ] socket options;
- [ ] namespace/routing provenance;
- [ ] target-side next-packet verification.

Initial child goals should build directly on Goal 17:

- [ ] distro ping known unread single reply;
- [ ] distro ping known in-flight single echo;
- [ ] distro ping multi-interval sequence continuity;
- [ ] TCP established loopback connection without broker, if exact sequence and
      peer-state gates can be proven;
- [ ] UDP loopback datagram queue subset.

No routed, internet, DNS, broadcast, multicast, policy-routing, or namespace
replay support may be claimed until those contracts have their own verifier
model.

## Track 3: Memory model completeness

Expand memory support beyond current private/guard/file-backed subsets:

- [ ] shared mappings;
- [ ] file-backed dirty pages with target file identity and stale-page gates;
- [ ] guard-page edge cases;
- [ ] W^X enforcement;
- [ ] JIT/self-modifying code refusal or exact code-provenance support;
- [ ] source-pointer relocation safety;
- [ ] stack/heap private range edge cases;
- [ ] huge pages and special mappings;
- [ ] vDSO/vvar handling or stable refusal.

Private anonymous memory is the easier path. Shared and kernel-backed memory must
remain fail-closed until exact source/target visibility and aliasing rules are
modeled.

## Track 4: Threading and synchronization

Broaden from narrow controlled proofs to general multi-thread process state:

- [ ] multi-thread register/frame restore;
- [ ] per-thread stack/TLS restoration;
- [ ] futex wait ownership;
- [ ] robust lists;
- [ ] rseq;
- [ ] thread-local storage edge cases;
- [ ] scheduler-visible waits;
- [ ] signal delivery races;
- [ ] thread creation/join state.

Every scheduler-visible wait must define who owns wakeup, timeout, signal, and
memory-ordering semantics after restore.

## Track 5: Signals and restartable syscalls

Add exact handling or stable refusal for:

- [ ] pending signals;
- [ ] active signal frames;
- [ ] alternate signal stacks;
- [ ] interrupted syscalls;
- [ ] restart blocks;
- [ ] timer signals;
- [ ] signal masks and dispositions;
- [ ] signal-handler PC/stack state.

Without this track, many real applications must remain fail-closed even if their
file descriptors and memory can be restored.

## Track 6: CPU/FPU/SIMD state

Do not claim general CPU state restoration until these are modeled and verified:

- [ ] full FPU/SIMD state translation/restoration;
- [ ] architecture-specific register state;
- [ ] flags and condition-code correctness;
- [ ] TLS/thread-pointer correctness across every supported thread;
- [ ] syscall ABI edge cases;
- [ ] target verifier coverage for restored architectural state.

Current distro ping semantic continuation does not count as general SIMD/FPU
restore.

## Track 7: Executable/code provenance

Strengthen code identity and execution provenance for:

- [ ] dynamic linker state;
- [ ] JIT code;
- [ ] self-modifying code;
- [ ] executable file mappings;
- [ ] deleted or replaced binaries;
- [ ] ASLR-sensitive pointers;
- [ ] vDSO/vvar references.

A target must never silently execute stale source text or unverified executable
bytes. Either prove target-native executable identity or refuse.

## Track 8: Validation scale

Make proof validation fast enough to support broad matrices:

- [ ] batch negative proofs in one VM boot;
- [ ] reusable source and target VMs;
- [ ] cached remote artifacts;
- [ ] matrix sharding;
- [ ] automatic artifact inventory;
- [ ] real workload suites, not only synthetic fixtures;
- [ ] per-profile timing and regression tracking;
- [ ] summary schema for batched parent/child proof results.

Validation-speed work is a product requirement: unsupported states must remain
cheap enough to test continuously.

## Required proof standard for each child goal

Every child goal that graduates support must include:

- [ ] accepted subset name and descriptor version;
- [ ] descriptor/schema changes;
- [ ] source capture evidence;
- [ ] target-native restore recipe;
- [ ] verifier gates;
- [ ] real arm64-to-amd64 positive proof where applicable;
- [ ] target-native negative proofs for neighboring states;
- [ ] stable refusal codes;
- [ ] docs/support-envelope updates;
- [ ] proof matrix updates;
- [ ] validation timings;
- [ ] explicit statement that no source-ISA emulation, sidecar runtime success,
      app hooks, hidden helpers, or source text replay were used.

## Master completion criteria

This master goal is complete only when the support envelope has a principled,
verified answer for each major class above:

1. supported with descriptor + target verifier + positive proof; or
2. intentionally refused with stable code + negative proof + documented reason.

The final audit must include:

- full support inventory;
- full refusal inventory;
- real workload suite results;
- cross-architecture arm64-to-amd64 proof coverage;
- validation-performance report;
- list of remaining permanent impossibilities, if any.
