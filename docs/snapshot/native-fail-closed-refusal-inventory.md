# Fail-closed refusal inventory

This inventory covers the refusal codes used by [`goal-002.md`](../../goals/goal-002.md). Each code marks a
state that must not reach `migrationCompleted=true` unless a later task replaces
the refusal with an exact target-native model and proof profile.

| Unsafe family                                           | Refusal code                              | Owner docs                                                                                                                                                             | Primary tests                                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sockets and socket transfer                             | `target-socket-syscall-state-unsupported` | `native-active-syscall-policy.md`, `native-arbitrary-boundary.md`, `native-resource-translation.md`, `portable-machine-proof-profiles.md`                              | `native-active-syscall-policy.test.ts`, `native-resource-translation.test.ts`, `portable-machine-proof-runner.test.ts`                                                                        |
| Epoll active/ambiguous state outside `interest-list-v1` | `target-epoll-syscall-state-unsupported`  | `native-active-syscall-policy.md`, `native-resource-translation.md`, `target-guest-restore-loader.md`, `portable-machine-proof-profiles.md`                            | `native-active-syscall-policy.test.ts`, `native-resource-translation.test.ts`, `target-guest-restore-loader.test.ts`, `portable-machine-proof-runner.test.ts`                                 |
| signalfd active/queued state outside `empty-queue-v1`   | `target-signalfd-state-unsupported`       | `native-active-syscall-policy.md`, `native-resource-translation.md`, `native-signal-policy.md`, `target-guest-restore-loader.md`, `portable-machine-proof-profiles.md` | `native-active-syscall-policy.test.ts`, `native-resource-translation.test.ts`, `native-signal-policy.test.ts`, `target-guest-restore-loader.test.ts`, `portable-machine-proof-runner.test.ts` |
| Futex wait state                                        | `futex-state-unsupported`                 | `native-two-thread-boundary.md`, `native-thread-refusal-matrix.md`, `portable-machine-proof-profiles.md`                                                               | `native-active-syscall-policy.test.ts`, `native-thread-refusal-matrix.test.ts`, `native-two-thread-boundary.test.ts`, `portable-machine-proof-runner.test.ts`                                 |
| rseq state                                              | `rseq-state-unsupported`                  | `native-two-thread-boundary.md`, `native-thread-refusal-matrix.md`, `portable-machine-proof-profiles.md`                                                               | `native-thread-refusal-matrix.test.ts`, `native-two-thread-boundary.test.ts`, `native-register-translation.test.ts`, `portable-machine-proof-runner.test.ts`                                  |
| Restart blocks / interrupted syscalls                   | `syscall-restart-unsupported`             | `native-active-syscall-policy.md`, `native-signal-policy.md`, `portable-machine-proof-profiles.md`                                                                     | `native-active-syscall-policy.test.ts`, `native-signal-policy.test.ts`, `portable-machine-proof-runner.test.ts`                                                                               |
| Signal mask / delivery ambiguity                        | `signal-state-unsupported`                | `native-signal-policy.md`, `portable-machine-proof-profiles.md`                                                                                                        | `native-signal-policy.test.ts`, `portable-machine-proof-runner.test.ts`                                                                                                                       |
| Readiness-aware wait ambiguity                          | `kernel-state-unsupported`                | `native-active-syscall-policy.md`, `native-resource-translation.md`, `portable-machine-proof-profiles.md`                                                              | `native-active-syscall-policy.test.ts`, `native-resource-translation.test.ts`, `portable-machine-proof-runner.test.ts`                                                                        |
| Readiness pollfd/fd-set ownership ambiguity             | `mapping-provenance-ambiguous`            | `native-active-syscall-policy.md`, `target-guest-memory-materialization.md`, `portable-machine-proof-profiles.md`                                                      | `native-active-syscall-policy.test.ts`, `target-guest-memory-materialization.test.ts`, `portable-machine-proof-runner.test.ts`                                                                |
| Process-context auxv source pointers                    | `target-process-context-unsupported`      | `target-guest-process-context-restore.md`, `native-arbitrary-boundary.md`, `portable-machine-proof-profiles.md`                                                        | `target-guest-process-context-restore.test.ts`, `portable-machine-proof-runner.test.ts`                                                                                                       |
| Private memory layout / pointer ambiguity               | `mapping-permission-unsupported`          | `target-guest-memory-materialization.md`, `native-arbitrary-boundary.md`, `portable-machine-proof-profiles.md`                                                         | `target-guest-memory-materialization.test.ts`, `native-mapping-materialization.test.ts`, `portable-machine-proof-runner.test.ts`                                                              |
| Shared mappings without target sharing contract         | `mapping-shared-unsupported`              | `target-guest-memory-materialization.md`, `target-guest-private-memory-restore.md`, `portable-machine-proof-profiles.md`                                               | `target-guest-memory-materialization.test.ts`, `target-guest-private-memory-restore.test.ts`, `portable-machine-proof-runner.test.ts`                                                         |
| Stale or partial private captured ranges                | `mapping-captured-range-unsupported`      | `target-guest-memory-materialization.md`, `target-guest-private-memory-restore.md`, `portable-machine-proof-profiles.md`                                               | `target-guest-memory-materialization.test.ts`, `target-guest-private-memory-restore.test.ts`, `portable-machine-proof-runner.test.ts`                                                         |
| Writable+executable or source executable bytes          | `mapping-executable-unsupported`          | `target-guest-memory-materialization.md`, `target-guest-executable-materialization.md`, `native-arbitrary-boundary.md`, `portable-machine-proof-profiles.md`           | `target-guest-memory-materialization.test.ts`, `target-guest-executable-materialization.test.ts`, `native-mapping-materialization.test.ts`, `portable-machine-proof-runner.test.ts`           |
| Ambiguous mapping permissions                           | `mapping-permission-unsupported`          | `native-mapping-materializer.md`, `target-guest-memory-materialization.md`, `native-arbitrary-boundary.md`                                                             | `native-mapping-materialization.test.ts`, `target-guest-memory-materialization.test.ts`                                                                                                       |
| Missing executable provenance                           | `mapping-provenance-ambiguous`            | `target-guest-executable-materialization.md`, `native-arbitrary-boundary.md`, `portable-machine-proof-profiles.md`                                                     | `target-guest-executable-materialization.test.ts`, `native-mapping-materialization.test.ts`, `portable-machine-proof-runner.test.ts`                                                          |
| Duplicate fd aliases without shared OFD semantics       | `target-fd-table-duplicate`               | `native-resource-translation.md`, `portable-machine-proof-profiles.md`                                                                                                 | `native-resource-translation.test.ts`, `portable-machine-proof-runner.test.ts`                                                                                                                |
| Target binary identity mismatch                         | `target-build-mismatch`                   | `target-guest-executable-materialization.md`, `native-arbitrary-boundary.md`                                                                                           | `native-mapping-materialization.test.ts`, `native-target-module-bytes.test.ts`                                                                                                                |
| Source vDSO/vvar copying                                | `vdso-policy-unsupported`                 | `native-arbitrary-boundary.md`, `target-guest-process-context-restore.md`, `portable-machine-proof-profiles.md`                                                        | `target-guest-process-context-restore.test.ts`, `target-guest-memory-materialization.test.ts`, `portable-machine-proof-runner.test.ts`                                                        |
| Raw cross-ISA whole-VM state                            | `cross-isa-vmstate-restore-unsupported`   | `vmstate-portability.md`, `portable-machine-snapshot.md`, `portable-machine-proof-profiles.md`                                                                         | `vmstate-portability.test.ts`, `portable-machine-proof-runner.test.ts`                                                                                                                        |
| Descriptor / target-code escape                         | `target-code-outside-portable-bundle`     | `portable-machine-vm-restore-proof.md`, `portable-machine-proof-profiles.md`                                                                                           | `portable-machine-restore-proof.test.ts`                                                                                                                                                      |
| Unsupported proof arch pair                             | `proof-arch-pair-unsupported`             | `portable-machine-vm-restore-proof.md`, `portable-machine-proof-profiles.md`                                                                                           | `portable-machine-restore-proof.test.ts`                                                                                                                                                      |

The negative proof profiles in
[`scripts/portable-machine-proof-profiles.json`](../../scripts/portable-machine-proof-profiles.json)
reference the same refusal codes. The proof runner checks those summaries with
`expectedResult: "refusal"`; a matching refusal is a pass only when migration did
not complete.

Goals 8, 9, 11, 12, 13, 14, and 15 graduate the app-neutral subsets documented in
[`goal-8-9-capability-graduations.md`](./goal-8-9-capability-graduations.md): a
real private multi-range memory plus regular-file workload, TCP
listeners, raw ICMP loopback echo, Linux ping-socket loopback echo, distro ping active `recvmsg` empty-queue wait, multiple private ranges with guards, acyclic
epoll graphs, file-backed private mappings, deterministic `EINTR`,
explicit-broker active TCP streams, listener readiness probes, private futex
wait/wake, rseq lifecycle, and shared-memory contracts. The neighboring unsafe
profiles keep active or queued connections, raw ICMP without capability or route
provenance, ping sockets without credential/range provenance, non-loopback ICMP,
in-flight/unread ICMP packets, active `recvmsg` queue/flag/signal ambiguity,
socket option ambiguity, fd aliases, W+X/stale/shared/source-only memory, epoll
cycles/edge/one-shot readiness, restart/signal ambiguity, missing brokers,
TLS/session opacity, PI/robust/shared futexes, active rseq critical sections,
and undeclared shared participants on the refusal codes in this table.

Goal 3 graduates only the epoll `interest-list-v1` subset to
`epoll-recreate`; active waits, nested epoll, edge-triggered/one-shot delivery,
unsupported watched fds, and malformed interest lists continue to use
`target-epoll-syscall-state-unsupported`. Goal 3 also graduates only the signalfd
`empty-queue-v1` descriptor subset to `signalfd-recreate`; pending signals,
queued `siginfo`, active signal frames, active alt-stack state, unsupported
flags, malformed masks, and active signalfd reads continue to use
`target-signalfd-state-unsupported`.

Goal 4 graduates the eventfd `eventfd-counter-v1` descriptor subset to
`eventfd-counter-recreate`: non-semaphore eventfds with exact nonzero counter,
known-empty waiters, supported flags, and close-on-exec provenance. Semaphore
mode, unknown waiters, unsupported flags, zero counters outside the existing
empty-eventfd proof, and overflow counters continue to require
`kernel-state-unsupported`. Goal 4 also graduates the `timerfd-descriptor-v1`
subset to `timerfd-descriptor-recreate`: disarmed or relative future one-shot
`CLOCK_MONOTONIC` timerfds with zero unread expirations, zero interval,
supported fd flags, and close-on-exec provenance. Periodic timers, expired or
overrun timers, absolute/cancel-on-set timers, unsupported clocks, and
unsupported timerfd fd flags continue to require `kernel-state-unsupported`. The
`pipe-pair-v1` subset graduates to `pipe-pair-recreate`: exactly one read end and
one write end for a known-empty pipe with open peer lifetime, no waiters,
not-readable readiness, supported fd flags, and close-on-exec provenance.
Non-empty/unknown buffers, missing or closed peers, waiter/readiness ambiguity,
EOF-only shapes, and unsupported pipe fd flags continue to require
`kernel-state-unsupported`.

Goal 5 records readiness-aware waits as intentionally refused unless every
watched resource has an accepted recipe and the target gate can prove level
readiness without scheduler wake-order claims. The `readiness-wait-refusal`
profile keeps unsupported watched fds, stale readiness, fd-set overflow,
signal-mask-changing waits, and ambiguous shared memory on
`kernel-state-unsupported`.

Goal 6 keeps source-owned auxv pointers and source vDSO/vvar bytes refused. The
`process-context` positive profile covers only bounded target-owned metadata and
selected auxv policy checks; `auxv-source-pointer-refusal` and
`source-vdso-vvar-refusal` prove that source-owned or ambiguous process-context
state cannot report migration success.

Goal 7 keeps broad heap/brk/private-mmap layout claims refused unless bounds,
permissions, guard gaps, zero-fill, and pointer ownership are exact. The current
positive profiles cover bounded private-memory materialization only;
`private-layout-refusal` covers unsupported permissions, overlapping ranges,
source-only pointers, stale hashes, and unexpected executable mappings.

Goal 8 keeps signal delivery and restart ambiguity refused. Empty signalfd queues
remain covered by `signalfd-recreate`, while pending signals, queued siginfo,
active frames, enabled alt-stacks, signal-mask-changing waits, and restart blocks
without exact remaining-time contracts stay on `signal-state-unsupported` or
`syscall-restart-unsupported`; `signal-mask-restart-refusal` and
`restart-state-refusal` guard those boundaries.

[`goal-005.md`](../../goals/goal-005.md) adds granular proof profiles for the Goals 9-13 refusal wave.
Readiness wake ordering, edge/one-shot readiness, socket readiness,
signal-mask-changing waits, and ambiguous pollfd/fd-set memory are refused by
`readiness-scheduler-refusal`, `readiness-edge-trigger-refusal`,
`socket-readiness-refusal`, `readiness-signal-mask-refusal`, and
`readiness-pollfd-memory-refusal`. Auxv/process-context expansions are guarded by
`at-random-source-refusal`, `at-execfn-identity-refusal`,
`target-libc-global-refusal`, and `argv-env-pointer-refusal`. Broader private
layout work is guarded by `shared-mapping-refusal`,
`private-source-pointer-refusal`, `stale-private-range-refusal`, and
`wx-private-mapping-refusal`. Signal/restart work is guarded by
`pending-signal-refusal`, `active-signal-frame-refusal`, `alt-stack-refusal`, and
`restart-remaining-time-refusal`. Duplicate fd aliases are guarded by
`duplicate-fd-alias-refusal`, `fd-alias-lock-refusal`,
`fd-alias-socket-refusal`, and `fd-alias-epoll-cycle-refusal` until shared
open-file-description semantics are exact. Goal 5 closes without adding a new
success subset: readiness waits, target auxv expansion, broader private layout,
signal/restart semantics, and duplicate fd aliases all remain refused until a
future task supplies the complete portable model, target-native restore recipe,
target verifier, positive proof, nearby negative proofs, docs, and timings.

Goal 6 graduates one narrow proof profile from each Goal 5 frontier while keeping
the neighboring unsafe states refused: `eventfd-readiness-pollin-recreate`,
`regular-file-duplicate-fd-recreate`, `target-auxv-at-random`,
`private-anonymous-data-range-recreate`, and `signal-mask-blocked-recreate`.
Unsupported scheduler ordering, socket readiness, source-owned auxv pointers,
shared/stale/W+X memory, pending signal delivery, restart ambiguity, and unsafe
fd aliases remain on the refusal codes listed above.

Goal 3 intentionally leaves sockets without a graduated support subset. Listening
sockets, connected socketpairs, TCP/Unix sockets, ancillary data, partial
transfers, and unbrokered endpoints continue to require
`target-socket-syscall-state-unsupported`; a future task must add an explicit
broker descriptor and authorization/provenance gates before any socket profile can
move to `graduated-support`.

Goal 3 leaves futex/rseq/scheduler state without a graduated support subset.
Words in copied private memory are data only; active futex waits, PI futexes,
robust-list owner-death transitions, rseq registration, active rseq critical
sections, and scheduler-ordering claims continue to require
`futex-state-unsupported` or `rseq-state-unsupported`.

Goal 3 also leaves JIT and self-modifying code without a graduated support
subset. Target-owned static executable mappings remain supported only through
explicit target build/hash provenance. Source-only executable bytes, ambiguous
executable provenance, writable+executable windows, stale hashes, and active
self-modifying state continue to require `mapping-executable-unsupported`; a
future task must add a target-native regeneration descriptor and hash/permission
gates before any JIT profile can move to `graduated-support`.
