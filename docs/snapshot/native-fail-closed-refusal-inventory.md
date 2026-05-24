# Fail-closed refusal inventory

This inventory covers the refusal codes used by `goal-2.md`. Each code marks a
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
| Writable+executable or source executable bytes          | `mapping-executable-unsupported`          | `target-guest-memory-materialization.md`, `target-guest-executable-materialization.md`, `native-arbitrary-boundary.md`, `portable-machine-proof-profiles.md`           | `target-guest-memory-materialization.test.ts`, `target-guest-executable-materialization.test.ts`, `native-mapping-materialization.test.ts`, `portable-machine-proof-runner.test.ts`           |
| Ambiguous mapping permissions                           | `mapping-permission-unsupported`          | `native-mapping-materializer.md`, `target-guest-memory-materialization.md`, `native-arbitrary-boundary.md`                                                             | `native-mapping-materialization.test.ts`, `target-guest-memory-materialization.test.ts`                                                                                                       |
| Missing executable provenance                           | `mapping-provenance-ambiguous`            | `target-guest-executable-materialization.md`, `native-arbitrary-boundary.md`, `portable-machine-proof-profiles.md`                                                     | `target-guest-executable-materialization.test.ts`, `native-mapping-materialization.test.ts`, `portable-machine-proof-runner.test.ts`                                                          |
| Target binary identity mismatch                         | `target-build-mismatch`                   | `target-guest-executable-materialization.md`, `native-arbitrary-boundary.md`                                                                                           | `native-mapping-materialization.test.ts`, `native-target-module-bytes.test.ts`                                                                                                                |
| Source vDSO/vvar copying                                | `vdso-policy-unsupported`                 | `native-arbitrary-boundary.md`, `target-guest-process-context-restore.md`, `portable-machine-proof-profiles.md`                                                        | `target-guest-process-context-restore.test.ts`, `target-guest-memory-materialization.test.ts`, `portable-machine-proof-runner.test.ts`                                                        |
| Raw cross-ISA whole-VM state                            | `cross-isa-vmstate-restore-unsupported`   | `vmstate-portability.md`, `portable-machine-snapshot.md`, `portable-machine-proof-profiles.md`                                                                         | `vmstate-portability.test.ts`, `portable-machine-proof-runner.test.ts`                                                                                                                        |
| Descriptor / target-code escape                         | `target-code-outside-portable-bundle`     | `portable-machine-vm-restore-proof.md`, `portable-machine-proof-profiles.md`                                                                                           | `portable-machine-restore-proof.test.ts`                                                                                                                                                      |
| Unsupported proof arch pair                             | `proof-arch-pair-unsupported`             | `portable-machine-vm-restore-proof.md`, `portable-machine-proof-profiles.md`                                                                                           | `portable-machine-restore-proof.test.ts`                                                                                                                                                      |

The negative proof profiles in
[`scripts/portable-machine-proof-profiles.json`](../../scripts/portable-machine-proof-profiles.json)
reference the same refusal codes. The proof runner checks those summaries with
`expectedResult: "refusal"`; a matching refusal is a pass only when migration did
not complete. Goal 3 graduates only the epoll `interest-list-v1` subset to
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
unsupported timerfd fd flags continue to require `kernel-state-unsupported`.

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
