# Goal 18: Master audit for near-complete portable snapshot/restore

Parent context:

- [`goal-016.md`](./goal-016.md) and [`goal-017.md`](./goal-017.md) kept
  distro ping packet/timer states fail-closed until exact packet/timer verifier
  gates exist.
- [`goal-019.md`](./goal-019.md) added the first validation-scale slice:
  sharding, summary caching, artifact inventory output, and real-workload matrix
  presets.

## Objective

Define and execute the multi-track roadmap required to move portable
snapshot/restore toward broad, app-neutral coverage. Success requires explicit
portable descriptor models, target-native restore recipes, target verifier gates,
positive real-workload proofs, and fail-closed negative matrices for every newly
supported state family.

This is a master goal. It is complete only by producing a verified support or
stable-refusal answer for every major class below, not by claiming broad restore
from documentation.

## Outcome

Goal 18 completes as a master support/refusal audit. It does not graduate a broad
“100% restore” claim. Instead, it records the current principled answer for every
major class:

1. supported only where a descriptor, target-native recipe, verifier gate, and
   positive proof already exist; or
2. intentionally refused with a stable refusal code, runnable negative proof
   profile, and documented reason.

Added 24 master-audit refusal profiles to close coverage gaps in the roadmap:

- `socket-receive-queue-general-refusal`;
- `socket-send-queue-general-refusal`;
- `udp-datagram-queue-refusal`;
- `tcp-established-without-broker-refusal`;
- `kqueue-readiness-refusal`;
- `file-lock-refusal`;
- `file-lease-refusal`;
- `mmap-dirty-alias-refusal`;
- `huge-page-special-mapping-refusal`;
- `simd-fpu-state-refusal`;
- `architecture-register-state-refusal`;
- `dynamic-linker-state-refusal`;
- `deleted-executable-mapping-refusal`;
- `aslr-sensitive-pointer-refusal`;
- `signal-handler-pc-stack-refusal`;
- `thread-join-state-refusal`;
- `thread-tls-edge-refusal`;
- `timer-delivery-order-refusal`;
- `pipe-buffered-data-waiter-refusal`;
- `eventfd-waiter-alias-refusal`;
- `namespace-routing-provenance-refusal`;
- `target-next-packet-unverified-refusal`;
- `stack-heap-edge-layout-refusal`;
- `vvar-time-source-refusal`.

These are intentionally refused until their descriptor/capture/restore/verifier
contracts exist.

## Core principle audit

- [x] No state family is claimed by approximation.
- [x] Existing supported families remain tied to descriptor/target verifier gates
      and proof profiles.
- [x] Unsupported neighboring states refuse with stable codes and
      `migrationCompleted=false`.
- [x] New master-audit gaps are represented as runnable negative proof profiles.

## Track 1: Kernel-visible state models

Current answer for kernel-owned state:

- [x] sockets with receive queues, send queues, and in-flight packets — refused
      by generic socket queue profiles plus raw/ping packet-state refusals.
- [x] TCP established connections — supported only through the explicit broker
      contract; established TCP without broker is refused by
      `tcp-established-without-broker-refusal` and earlier TCP refusals.
- [x] UDP sockets and datagram queues — refused by
      `udp-datagram-queue-refusal`.
- [x] epoll/kqueue readiness lists — bounded epoll subsets are supported;
      edge/oneshot/ambiguous readiness remain refused; kqueue is refused by
      `kqueue-readiness-refusal` for the Linux target contract.
- [x] futex wait ownership and robust-list state — one private futex subset is
      supported; robust/shared/PI/requeue/multiple-waiter variants remain
      refused.
- [x] rseq registration and restart/lifecycle state — target-owned absent or
      registered subset is supported; active/mismatched/source TLS/scheduler
      variants remain refused.
- [x] pending signals and active signal frames — refused except blocked-mask-only
      support.
- [x] timers with exact delivery order — disarmed/relative one-shot timerfd
      subset is supported; ordering-dependent timers are refused by
      `timer-delivery-order-refusal`.
- [x] pipes/eventfds with aliases, buffered data, counters, and waiters — empty
      pipe and non-semaphore eventfd counter/readiness subsets are supported;
      waiters/aliases/buffered ambiguity are refused.
- [x] shared memory mappings — one explicit shared-memory contract is supported;
      unsupported backings, stale dirty, cross-process ambiguity, and executable
      variants remain refused.
- [x] file locks, leases, and mmap dirtiness — refused by `file-lock-refusal`,
      `file-lease-refusal`, `mmap-dirty-alias-refusal`, and existing dirty/stale
      mapping refusals.

## Track 2: Packet/network continuation

Current answer for packet/network state:

- [x] packet queues — refused outside exact raw/ping empty-queue contracts.
- [x] in-flight packets — refused by raw/ping in-flight profiles and master
      socket queue profiles.
- [x] sequence numbers — supported only for narrow raw ICMP and ping-socket
      loopback verifier gates; broader packet sequence continuity is refused.
- [x] peer identity — supported only in bounded loopback/broker contracts;
      source routing/namespace provenance remains refused.
- [x] socket options — allowlisted options only; unknown options/filter state
      refused.
- [x] namespace/routing provenance — refused by existing wrong-namespace/stale
      route profiles and `namespace-routing-provenance-refusal`.
- [x] target-side next-packet verification — required for graduation; missing
      gates are refused by `target-next-packet-unverified-refusal` and Goal 17
      packet-state refusals.
- [x] distro ping known unread/in-flight/multi-interval candidates — remain
      refused by Goal 17.
- [x] TCP established loopback without broker — refused.
- [x] UDP loopback datagram queue subset — refused until exact queue contract
      exists.

## Track 3: Memory model completeness

Current answer for memory state:

- [x] shared mappings — explicit shared-memory subset supported; ambiguous
      variants refused.
- [x] file-backed dirty pages — supported only for bounded target file identity
      and dirty overlay subsets; stale/alias ambiguity refused.
- [x] guard pages — supported in bounded private multi-range proofs; edge cases
      remain refused by mapping/layout profiles.
- [x] W^X enforcement — executable/source-owned writable ambiguity refused.
- [x] JIT/self-modifying code — refused by `jit-self-modifying-refusal`.
- [x] source-pointer relocation safety — unsupported source pointers refused.
- [x] stack/heap private range edge cases — refused by
      `stack-heap-edge-layout-refusal` until exact layout provenance exists.
- [x] huge pages and special mappings — refused by
      `huge-page-special-mapping-refusal`.
- [x] vDSO/vvar handling — refused by existing `source-vdso-vvar-refusal` and
      `vvar-time-source-refusal` unless target-owned policy is explicit.

## Track 4: Threading and synchronization

Current answer for threading/synchronization:

- [x] multi-thread register/frame restore — supported only for controlled
      two-thread proof; general multi-thread state remains bounded/refused.
- [x] per-thread stack/TLS restoration — current target TLS gates are bounded;
      edge cases refused by `thread-tls-edge-refusal`.
- [x] futex wait ownership — one private one-waiter/one-wake subset supported;
      other ownership cases refused.
- [x] robust lists — refused.
- [x] rseq — bounded target-owned subset supported; unsafe variants refused.
- [x] scheduler-visible waits — supported only where deterministic wake/timeout
      gates exist; otherwise refused.
- [x] signal delivery races — refused by pending/active signal and timer-order
      profiles.
- [x] thread creation/join state — controlled spawn proof supported;
      join/lifecycle state refused by `thread-join-state-refusal`.

## Track 5: Signals and restartable syscalls

Current answer for signal/restart state:

- [x] pending signals — refused.
- [x] active signal frames — refused.
- [x] alternate signal stacks — refused.
- [x] interrupted syscalls — accepted only for specific deterministic EINTR
      subsets; unsupported restart state refused.
- [x] restart blocks — refused.
- [x] timer signals — refused unless covered by bounded timerfd/recvmsg empty
      wait contracts.
- [x] signal masks and dispositions — blocked-mask-only subset supported;
      changing masks/dispositions outside that subset refused.
- [x] signal-handler PC/stack state — refused by
      `signal-handler-pc-stack-refusal`.

## Track 6: CPU/FPU/SIMD state

Current answer for architectural state:

- [x] full FPU/SIMD state translation/restoration — refused by
      `simd-fpu-state-refusal`; current distro ping continuation is semantic,
      not general SIMD/FPU restore.
- [x] architecture-specific register state — accepted only where target verifier
      gates cover the register/flag bank; broader state refused by
      `architecture-register-state-refusal`.
- [x] flags and condition codes — bounded verifier support only; broader cases
      refused.
- [x] TLS/thread-pointer correctness — bounded support; edge cases refused.
- [x] syscall ABI edge cases — unsupported active syscall/restart variants
      refused.
- [x] target verifier coverage — required before any future graduation.

## Track 7: Executable/code provenance

Current answer for executable/code state:

- [x] dynamic linker state — refused by `dynamic-linker-state-refusal`.
- [x] JIT code — refused.
- [x] self-modifying code — refused.
- [x] executable file mappings — supported only when target-native executable
      identity/provenance gates pass; unknown executable mappings refused.
- [x] deleted or replaced binaries — refused by
      `deleted-executable-mapping-refusal`.
- [x] ASLR-sensitive pointers — refused by `aslr-sensitive-pointer-refusal`.
- [x] vDSO/vvar references — refused unless target-owned policy exists.

## Track 8: Validation scale

Current answer for validation scale:

- [x] batch negative proofs in one VM boot — not implemented; intentionally
      deferred with a measured follow-up in Goal 19.
- [x] reusable source and target VMs — not implemented as persistent VMs;
      remote proof hosts and cached assets are documented and reused.
- [x] cached remote artifacts — distro ping image caching and matrix summary
      cache support exist.
- [x] matrix sharding — implemented in Goal 19.
- [x] automatic artifact inventory — implemented in Goal 19.
- [x] real workload suites — `real-workload` and `real-workload-positive` matrix
      presets implemented in Goal 19.
- [x] per-profile timing and regression tracking — matrix summaries record
      per-profile timings; broader regression dashboards remain future work.
- [x] summary schema for batched parent/child proof results — not implemented;
      documented as required for future VM-boot batching.

## Required proof standard audit

- [x] Existing graduated support profiles retain accepted subset names and
      descriptor versions.
- [x] Existing graduated support profiles have descriptor/schema changes,
      target-native recipes, verifier gates, positive proofs, and negative
      variants recorded in their child goals.
- [x] New master-audit families are not graduated; each has a stable refusal code
      and negative proof profile.
- [x] Support-envelope docs and profile counts were updated.
- [x] Proof matrices validate the expanded support/refusal inventory.
- [x] Validation timings are recorded below.
- [x] No new support claim uses source-ISA emulation, sidecar runtime success,
      app hooks, hidden helpers, or source text replay.

## Final inventory

- 215 profiles total;
- 39 expected success profiles;
- 176 expected refusal profiles;
- support status counts: 11 baseline success, 28 graduated support, 173
  intentional refusal, 3 permanent refusal.

## Real workload and cross-architecture proof coverage

Real cross-architecture arm64-to-amd64 support remains covered by the already
proved real workload profiles, including private multi-range file state, TCP
listener/readiness/active broker, raw ICMP, ping socket, non-root ping socket,
and distro ping active `recvmsg` empty-queue continuation. Goal 18 does not add a
new positive real workload; it adds master refusal coverage for the remaining
unmodeled state families.

## Validation-performance report

Goal 19 delivered the first validation-scale implementation:

- deterministic matrix sharding;
- reusable smoke-summary caching;
- standalone artifact inventory output;
- real-workload matrix presets.

Remaining validation-scale follow-up:

- batched target-native negative proofs in one VM boot;
- persistent reusable source/target VMs;
- timing regression dashboards.

## Permanent impossibilities / stable refusals

Permanent or currently stable fail-closed areas include raw cross-ISA VM state
replay, source vDSO/vvar reuse without target-owned policy, and descriptor
provenance ambiguity. kqueue is treated as refused for the Linux target contract
unless a future non-Linux target contract exists.

## Validation timings

| Category           | Command/proof                                                                                                                                                                                              |    Time | Result                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------: | --------------------------------------------- |
| Schema             | `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`                                                                                                                                  |  0.164s | passed                                        |
| Focused tests      | `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts packages/runtime/src/__tests__/portable-machine-proof-matrix.test.ts`                 |  3.645s | passed                                        |
| Matrix             | `pnpm --silent portable-machine-proof-matrix -- --preset refusal --summary-cache-dir /tmp/refusal-summaries-18 --artifact-inventory /tmp/refusal18-artifacts.json --json --continue-on-fail`               |  4.090s | passed; 176 refusal profiles                  |
| Matrix             | `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --summary-cache-dir /tmp/foundation-summaries-18 --artifact-inventory /tmp/foundation18-artifacts.json --json --continue-on-fail` |  4.978s | passed; 215 profiles, 39 success, 176 refusal |
| Local static       | `pnpm run format:check`                                                                                                                                                                                    |  0.643s | passed                                        |
| Local static       | `pnpm run lint`                                                                                                                                                                                            |  0.190s | passed                                        |
| Docs/API           | `pnpm run build:docs`                                                                                                                                                                                      |  1.629s | passed                                        |
| Local static       | `pnpm run typecheck`                                                                                                                                                                                       |  2.117s | passed                                        |
| Local unit tests   | `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`                                                                                                                                                           | 26.949s | passed                                        |
| Architecture audit | `pnpm exec fallow audit --changed-since origin/main`                                                                                                                                                       |  0.383s | passed                                        |
| Whitespace         | `git diff --check`                                                                                                                                                                                         |  0.016s | passed                                        |

Full smoke tests are not required for this master-audit delta unless code changes
touch VM/VMM, rootfs/base assets, CLI boot/exec/mount, snapshot/restore runtime
behavior, virtio devices, memory/ballooning, or FUSE/live mounts. The current
implementation adds proof-profile refusals and documentation only.

## Master completion criteria audit

- [x] Full support inventory recorded.
- [x] Full refusal inventory recorded.
- [x] Real workload suite coverage recorded.
- [x] Cross-architecture arm64-to-amd64 proof coverage recorded.
- [x] Validation-performance report recorded.
- [x] Remaining permanent/stable impossibilities recorded.
- [x] Every major class above has a principled current answer: supported with
      descriptor/verifier/proof, or intentionally refused with stable code and
      negative proof profile.
