# Goal 22: Concrete target-native negative proofs for Goal 21 neighbors

Parent context: [`goal-021.md`](./goal-021.md) added Goal 21 positive
graduation profiles and 245 negative-neighbor profiles for Targets 2-50. Those
negative profiles currently prove the refusal contract at the profile/matrix
level. This follow-up upgrades those 245 negative neighbors into concrete,
fixture-driven target-native refusal proofs.

## Objective

Replace every synthetic/profile-only Goal 21 negative neighbor proof with a real
source-capture or descriptor-fixture proof that exercises the actual unsupported
kernel/runtime state and reaches a target-native refusal before migration
completion.

This goal is complete only when all 245 Goal 21 negative-neighbor profiles below
are concrete target-native negative proofs, not metadata-only synthetic refusals.

## Required proof standard

Each negative profile is complete only after all of these are true:

- a concrete source fixture, descriptor fixture, or restore-descriptor fixture
  exists for the exact neighbor state;
- capture/descriptor construction records the actual unsupported condition rather
  than merely naming it;
- the target restore path is invoked and refuses at the intended gate;
- the refusal code is stable and matches the profile;
- `migrationCompleted=false`;
- source-ISA emulation, runtime sidecars, app hooks, hidden helpers, and source
  text replay are not used as success or refusal mechanisms;
- the adjacent positive Goal 21 profile still passes;
- the refusal matrix and foundation matrix pass with checked summaries;
- artifacts and timings are recorded in this file.

A negative proof may fail at descriptor/resource/verifier gates as appropriate,
but it must be driven by concrete state and not by a synthetic runner shortcut.

## Implementation rules

- Keep all Goal 21 positive subsets narrow; do not broaden success while adding
  negative fixtures.
- Prefer one reusable fixture per state family when it can parameterize multiple
  neighbors without weakening the proof.
- If a neighbor cannot be reproduced on the local/remote kernel, record the exact
  kernel reason and add an equivalent concrete malformed-descriptor or
  target-verifier refusal that protects the same boundary.
- Remove or retire `synthetic-negative:goal21/...` for a profile only after its
  concrete replacement passes.
- Do not mark a batch complete until every profile in that batch has concrete
  artifacts and timings.

## Batches

### Batch 2: UDP loopback single queued datagram v1

Positive profile: `udp-loopback-single-queued-datagram-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `udp-loopback-single-queued-datagram-v1-multiple-datagrams-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-non-loopback-route-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-socket-alias-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-stale-route-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-unknown-packet-bytes-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 3: UDP connected empty socket v1

Positive profile: `udp-connected-empty-socket-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `udp-connected-empty-socket-v1-namespace-mismatch-refusal`
  - [x] `udp-connected-empty-socket-v1-non-loopback-refusal`
  - [x] `udp-connected-empty-socket-v1-pending-datagram-refusal`
  - [x] `udp-connected-empty-socket-v1-route-mismatch-refusal`
  - [x] `udp-connected-empty-socket-v1-unsupported-socket-option-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 4: Regular-file OFD advisory lock v1

Positive profile: `regular-file-ofd-advisory-lock-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `regular-file-ofd-advisory-lock-v1-duplicated-unknown-ofd-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-lock-conflict-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-mandatory-lock-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-posix-owner-lock-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-stale-inode-digest-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 5: Regular-file POSIX advisory lock v1

Positive profile: `regular-file-posix-advisory-lock-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `regular-file-posix-advisory-lock-v1-cross-process-owner-ambiguity-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-inherited-lock-through-fork-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-lease-interaction-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-lock-conflict-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-stale-file-identity-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 6: Clean MAP_SHARED regular-file mapping v1

Positive profile: `clean-map-shared-regular-file-mapping-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `clean-map-shared-regular-file-mapping-v1-dirty-shared-page-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-executable-mapping-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-missing-participant-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-stale-digest-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-writable-mapping-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 7: Dirty MAP_PRIVATE file alias v1

Positive profile: `dirty-map-private-file-alias-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `dirty-map-private-file-alias-v1-ambiguous-dirty-owner-refusal`
  - [x] `dirty-map-private-file-alias-v1-digest-mismatch-refusal`
  - [x] `dirty-map-private-file-alias-v1-overlapping-dirty-ranges-refusal`
  - [x] `dirty-map-private-file-alias-v1-source-only-path-refusal`
  - [x] `dirty-map-private-file-alias-v1-stale-overlay-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 8: File-backed executable text mapping v1

Positive profile: `file-backed-executable-text-mapping-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `file-backed-executable-text-mapping-v1-deleted-executable-refusal`
  - [x] `file-backed-executable-text-mapping-v1-missing-build-id-refusal`
  - [x] `file-backed-executable-text-mapping-v1-relocation-pointer-ambiguity-refusal`
  - [x] `file-backed-executable-text-mapping-v1-source-only-executable-refusal`
  - [x] `file-backed-executable-text-mapping-v1-writable-text-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 9: Deleted executable by content-addressed copy v1

Positive profile: `deleted-executable-by-content-addressed-copy-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `deleted-executable-by-content-addressed-copy-v1-dynamic-loader-relocation-drift-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-mismatched-digest-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-source-path-replay-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-unknown-file-identity-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-writable-executable-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 10: Eventfd semaphore single counter v1

Positive profile: `eventfd-semaphore-single-counter-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `eventfd-semaphore-single-counter-v1-aliases-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-stale-counter-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-unsupported-flags-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-waiter-present-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-zero-counter-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 11: Eventfd nonblocking counter v1

Positive profile: `eventfd-nonblocking-counter-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `eventfd-nonblocking-counter-v1-alias-ambiguity-refusal`
  - [x] `eventfd-nonblocking-counter-v1-blocked-reader-refusal`
  - [x] `eventfd-nonblocking-counter-v1-close-on-exec-mismatch-refusal`
  - [x] `eventfd-nonblocking-counter-v1-semaphore-mode-refusal`
  - [x] `eventfd-nonblocking-counter-v1-stale-counter-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 12: Eventfd three-fd alias v1

Positive profile: `eventfd-three-fd-alias-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `eventfd-three-fd-alias-v1-cross-process-alias-refusal`
  - [x] `eventfd-three-fd-alias-v1-four-or-more-aliases-refusal`
  - [x] `eventfd-three-fd-alias-v1-hidden-helper-refusal`
  - [x] `eventfd-three-fd-alias-v1-mixed-flags-refusal`
  - [x] `eventfd-three-fd-alias-v1-stale-counter-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 13: Eventfd blocked reader v1

Positive profile: `eventfd-blocked-reader-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `eventfd-blocked-reader-v1-alias-waiter-refusal`
  - [x] `eventfd-blocked-reader-v1-multiple-waiters-refusal`
  - [x] `eventfd-blocked-reader-v1-nonzero-counter-race-refusal`
  - [x] `eventfd-blocked-reader-v1-scheduler-ambiguity-refusal`
  - [x] `eventfd-blocked-reader-v1-semaphore-waiter-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 14: Timerfd expired-count v1

Positive profile: `timerfd-expired-count-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `timerfd-expired-count-v1-non-monotonic-clock-refusal`
  - [x] `timerfd-expired-count-v1-pending-signal-ordering-refusal`
  - [x] `timerfd-expired-count-v1-periodic-timer-refusal`
  - [x] `timerfd-expired-count-v1-stale-clock-base-refusal`
  - [x] `timerfd-expired-count-v1-unknown-overrun-count-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 15: Timerfd periodic no-overrun v1

Positive profile: `timerfd-periodic-no-overrun-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `timerfd-periodic-no-overrun-v1-absolute-time-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-elapsed-ticks-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-multiple-timers-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-realtime-clock-step-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-signal-interaction-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 16: Signalfd queued standard signal v1

Positive profile: `signalfd-queued-standard-signal-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `signalfd-queued-standard-signal-v1-alt-stack-handler-refusal`
  - [x] `signalfd-queued-standard-signal-v1-multiple-pending-signals-refusal`
  - [x] `signalfd-queued-standard-signal-v1-pid-uid-mismatch-refusal`
  - [x] `signalfd-queued-standard-signal-v1-realtime-signal-queue-refusal`
  - [x] `signalfd-queued-standard-signal-v1-unblocked-delivery-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 17: Pending blocked signal queue v1

Positive profile: `pending-blocked-signal-queue-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `pending-blocked-signal-queue-v1-cross-thread-delivery-refusal`
  - [x] `pending-blocked-signal-queue-v1-handler-already-active-refusal`
  - [x] `pending-blocked-signal-queue-v1-multiple-pending-signals-refusal`
  - [x] `pending-blocked-signal-queue-v1-realtime-ordering-refusal`
  - [x] `pending-blocked-signal-queue-v1-unblocked-signal-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 18: Signal alt-stack inactive v1

Positive profile: `signal-alt-stack-inactive-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `signal-alt-stack-inactive-v1-active-alt-stack-frame-refusal`
  - [x] `signal-alt-stack-inactive-v1-guard-page-mismatch-refusal`
  - [x] `signal-alt-stack-inactive-v1-pending-signal-refusal`
  - [x] `signal-alt-stack-inactive-v1-source-owned-memory-refusal`
  - [x] `signal-alt-stack-inactive-v1-stale-pointer-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 19: Active signal frame deterministic return v1

Positive profile: `active-signal-frame-deterministic-return-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `active-signal-frame-deterministic-return-v1-alt-stack-ambiguity-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-modified-ucontext-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-nested-frames-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-pending-signal-ordering-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-source-pc-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 20: PPOLL signal-mask-change wait v1

Positive profile: `ppoll-signal-mask-change-wait-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `ppoll-signal-mask-change-wait-v1-changing-sigset-pointer-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-pending-signal-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-ready-fd-race-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-scheduler-ordering-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-timeout-ambiguity-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 21: Restartable nanosleep remaining-time v1

Positive profile: `restartable-nanosleep-remaining-time-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `restartable-nanosleep-remaining-time-v1-absolute-clock-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-signal-handler-restart-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-stale-remaining-time-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-timer-delivery-ordering-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-unsupported-syscall-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 22: Restart-block futex wait timeout v1

Positive profile: `restart-block-futex-wait-timeout-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `restart-block-futex-wait-timeout-v1-owner-death-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-pi-futex-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-requeue-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-shared-futex-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-signal-mask-changing-restart-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 23: Private futex timeout v1

Positive profile: `private-futex-timeout-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `private-futex-timeout-v1-absolute-timeout-refusal`
  - [x] `private-futex-timeout-v1-multiple-waiters-refusal`
  - [x] `private-futex-timeout-v1-owner-death-refusal`
  - [x] `private-futex-timeout-v1-shared-futex-refusal`
  - [x] `private-futex-timeout-v1-stale-futex-word-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 24: Private futex multiple waiters v1

Positive profile: `private-futex-multiple-waiters-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `private-futex-multiple-waiters-v1-more-than-two-waiters-refusal`
  - [x] `private-futex-multiple-waiters-v1-pi-futex-refusal`
  - [x] `private-futex-multiple-waiters-v1-requeue-refusal`
  - [x] `private-futex-multiple-waiters-v1-scheduler-ambiguity-refusal`
  - [x] `private-futex-multiple-waiters-v1-shared-futex-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 25: Shared futex intra-process v1

Positive profile: `shared-futex-intra-process-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `shared-futex-intra-process-v1-external-participant-refusal`
  - [x] `shared-futex-intra-process-v1-pi-futex-refusal`
  - [x] `shared-futex-intra-process-v1-requeue-refusal`
  - [x] `shared-futex-intra-process-v1-robust-list-refusal`
  - [x] `shared-futex-intra-process-v1-stale-shared-backing-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 26: Robust futex list empty v1

Positive profile: `robust-futex-list-empty-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `robust-futex-list-empty-v1-malformed-list-refusal`
  - [x] `robust-futex-list-empty-v1-non-empty-robust-list-refusal`
  - [x] `robust-futex-list-empty-v1-owner-death-pending-refusal`
  - [x] `robust-futex-list-empty-v1-shared-futex-refusal`
  - [x] `robust-futex-list-empty-v1-source-tls-pointer-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 27: Rseq registered idle v1

Positive profile: `rseq-registered-idle-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `rseq-registered-idle-v1-active-critical-section-refusal`
  - [x] `rseq-registered-idle-v1-mismatched-signature-refusal`
  - [x] `rseq-registered-idle-v1-scheduler-ambiguity-refusal`
  - [x] `rseq-registered-idle-v1-source-tls-pointer-refusal`
  - [x] `rseq-registered-idle-v1-thread-inconsistency-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 28: Rseq active critical section abort v1

Positive profile: `rseq-active-critical-section-abort-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `rseq-active-critical-section-abort-v1-modified-critical-section-memory-refusal`
  - [x] `rseq-active-critical-section-abort-v1-scheduler-race-refusal`
  - [x] `rseq-active-critical-section-abort-v1-source-text-refusal`
  - [x] `rseq-active-critical-section-abort-v1-tls-mismatch-refusal`
  - [x] `rseq-active-critical-section-abort-v1-unknown-abort-handler-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 29: Memfd seal set v1

Positive profile: `memfd-seal-set-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `memfd-seal-set-v1-missing-participant-refusal`
  - [x] `memfd-seal-set-v1-seal-mismatch-refusal`
  - [x] `memfd-seal-set-v1-source-only-backing-refusal`
  - [x] `memfd-seal-set-v1-stale-dirty-overlay-refusal`
  - [x] `memfd-seal-set-v1-writable-executable-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 30: Shared memory two-thread participant v1

Positive profile: `shared-memory-two-thread-participant-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `shared-memory-two-thread-participant-v1-executable-mapping-refusal`
  - [x] `shared-memory-two-thread-participant-v1-external-process-refusal`
  - [x] `shared-memory-two-thread-participant-v1-missing-thread-refusal`
  - [x] `shared-memory-two-thread-participant-v1-stale-dirty-overlay-refusal`
  - [x] `shared-memory-two-thread-participant-v1-unsupported-backing-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 31: Shared memory dirty overlay v1

Positive profile: `shared-memory-dirty-overlay-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `shared-memory-dirty-overlay-v1-executable-mapping-refusal`
  - [x] `shared-memory-dirty-overlay-v1-missing-participant-refusal`
  - [x] `shared-memory-dirty-overlay-v1-seal-mismatch-refusal`
  - [x] `shared-memory-dirty-overlay-v1-stale-overlay-refusal`
  - [x] `shared-memory-dirty-overlay-v1-unsupported-backing-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 32: Socket readiness empty TCP listener v1

Positive profile: `socket-readiness-empty-tcp-listener-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `socket-readiness-empty-tcp-listener-v1-alias-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-edge-triggered-watch-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-in-flight-accept-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-queued-accept-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-scheduler-race-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 33: TCP listener single queued accept v1

Positive profile: `tcp-listener-single-queued-accept-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `tcp-listener-single-queued-accept-v1-in-flight-accept-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-listener-alias-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-multiple-queued-accepts-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-non-loopback-peer-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-socket-option-mismatch-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 34: Active accept syscall v1

Positive profile: `active-accept-syscall-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `active-accept-syscall-v1-listener-alias-refusal`
  - [x] `active-accept-syscall-v1-multiple-waiters-refusal`
  - [x] `active-accept-syscall-v1-nonblocking-accept-refusal`
  - [x] `active-accept-syscall-v1-queued-connection-race-refusal`
  - [x] `active-accept-syscall-v1-signal-interruption-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 35: TCP broker half-close v1

Positive profile: `tcp-broker-half-close-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `tcp-broker-half-close-v1-both-sides-closed-refusal`
  - [x] `tcp-broker-half-close-v1-missing-broker-refusal`
  - [x] `tcp-broker-half-close-v1-oob-data-refusal`
  - [x] `tcp-broker-half-close-v1-tls-session-refusal`
  - [x] `tcp-broker-half-close-v1-unread-byte-mismatch-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 36: TCP broker unread byte window v1

Positive profile: `tcp-broker-unread-byte-window-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `tcp-broker-unread-byte-window-v1-mismatched-bytes-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-non-tcp-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-oob-data-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-tls-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-wrong-broker-arch-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 37: Raw ICMP known unread reply v1

Positive profile: `raw-icmp-known-unread-reply-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `raw-icmp-known-unread-reply-v1-ancillary-data-ambiguity-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-id-mismatch-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-multiple-replies-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-non-loopback-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-stale-route-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 38: Raw ICMP known in-flight echo v1

Positive profile: `raw-icmp-known-in-flight-echo-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `raw-icmp-known-in-flight-echo-v1-hidden-sidecar-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-lost-packet-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-multiple-in-flight-packets-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-route-mismatch-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-wrong-namespace-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 39: Raw ICMP BPF filter v1

Positive profile: `raw-icmp-bpf-filter-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `raw-icmp-bpf-filter-v1-ebpf-program-refusal`
  - [x] `raw-icmp-bpf-filter-v1-filter-mismatch-refusal`
  - [x] `raw-icmp-bpf-filter-v1-icmpv6-refusal`
  - [x] `raw-icmp-bpf-filter-v1-source-only-helper-refusal`
  - [x] `raw-icmp-bpf-filter-v1-unsupported-instruction-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 40: Ping socket known unread reply v3

Positive profile: `ping-socket-known-unread-reply-v3-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `ping-socket-known-unread-reply-v3-ancillary-ambiguity-refusal`
  - [x] `ping-socket-known-unread-reply-v3-id-mismatch-refusal`
  - [x] `ping-socket-known-unread-reply-v3-multiple-replies-refusal`
  - [x] `ping-socket-known-unread-reply-v3-non-loopback-refusal`
  - [x] `ping-socket-known-unread-reply-v3-wrong-credentials-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 41: Ping socket known in-flight echo v3

Positive profile: `ping-socket-known-in-flight-echo-v3-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `ping-socket-known-in-flight-echo-v3-icmpv6-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-multiple-in-flight-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-stale-route-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-timer-interval-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-unknown-bytes-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 42: Distro ping ppoll transition v3

Positive profile: `distro-ping-ppoll-transition-v3-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `distro-ping-ppoll-transition-v3-control-message-ambiguity-refusal`
  - [x] `distro-ping-ppoll-transition-v3-multi-interval-sequence-refusal`
  - [x] `distro-ping-ppoll-transition-v3-pending-reply-refusal`
  - [x] `distro-ping-ppoll-transition-v3-signal-mask-change-refusal`
  - [x] `distro-ping-ppoll-transition-v3-timer-delivery-ambiguity-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 43: Ping socket ancillary data v3

Positive profile: `ping-socket-ancillary-data-v3-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `ping-socket-ancillary-data-v3-icmpv6-refusal`
  - [x] `ping-socket-ancillary-data-v3-multiple-replies-refusal`
  - [x] `ping-socket-ancillary-data-v3-source-kernel-only-metadata-refusal`
  - [x] `ping-socket-ancillary-data-v3-timestamp-drift-refusal`
  - [x] `ping-socket-ancillary-data-v3-unknown-cmsg-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 44: ICMPv6 ping socket loopback v1

Positive profile: `icmpv6-ping-socket-loopback-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `icmpv6-ping-socket-loopback-v1-extension-headers-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-non-loopback-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-queued-packet-ambiguity-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-route-mismatch-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-wrong-credentials-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 45: ICMPv6 raw socket loopback v1

Positive profile: `icmpv6-raw-socket-loopback-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `icmpv6-raw-socket-loopback-v1-missing-capability-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-non-loopback-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-route-mismatch-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-unread-packet-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-unsupported-options-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 46: Epoll oneshot level graph v1

Positive profile: `epoll-oneshot-level-graph-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `epoll-oneshot-level-graph-v1-already-fired-oneshot-refusal`
  - [x] `epoll-oneshot-level-graph-v1-ambiguous-ready-list-refusal`
  - [x] `epoll-oneshot-level-graph-v1-cycle-refusal`
  - [x] `epoll-oneshot-level-graph-v1-edge-triggered-refusal`
  - [x] `epoll-oneshot-level-graph-v1-stale-watch-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 47: Epoll edge-triggered empty v1

Positive profile: `epoll-edge-triggered-empty-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `epoll-edge-triggered-empty-v1-cycle-refusal`
  - [x] `epoll-edge-triggered-empty-v1-pending-edge-refusal`
  - [x] `epoll-edge-triggered-empty-v1-ready-list-ambiguity-refusal`
  - [x] `epoll-edge-triggered-empty-v1-socket-watch-refusal`
  - [x] `epoll-edge-triggered-empty-v1-stale-watch-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 48: Epoll ready-list explicit v1

Positive profile: `epoll-ready-list-explicit-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `epoll-ready-list-explicit-v1-edge-triggered-refusal`
  - [x] `epoll-ready-list-explicit-v1-multiple-ready-items-refusal`
  - [x] `epoll-ready-list-explicit-v1-one-shot-fired-state-refusal`
  - [x] `epoll-ready-list-explicit-v1-scheduler-race-refusal`
  - [x] `epoll-ready-list-explicit-v1-stale-watch-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 49: Thread join completed child v1

Positive profile: `thread-join-completed-child-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `thread-join-completed-child-v1-detached-thread-refusal`
  - [x] `thread-join-completed-child-v1-multiple-joiners-refusal`
  - [x] `thread-join-completed-child-v1-robust-futex-interaction-refusal`
  - [x] `thread-join-completed-child-v1-running-child-refusal`
  - [x] `thread-join-completed-child-v1-source-tls-pointer-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

### Batch 50: Thread TLS dynamic slot v1

Positive profile: `thread-tls-dynamic-slot-v1-recreate`

- [x] Replace and verify concrete negative proofs:
  - [x] `thread-tls-dynamic-slot-v1-cross-thread-alias-refusal`
  - [x] `thread-tls-dynamic-slot-v1-dso-tls-relocation-refusal`
  - [x] `thread-tls-dynamic-slot-v1-rseq-tls-conflict-refusal`
  - [x] `thread-tls-dynamic-slot-v1-source-pointer-refusal`
  - [x] `thread-tls-dynamic-slot-v1-stale-thread-pointer-refusal`
- [x] Re-run adjacent positive profile and record timing.
- [x] Record concrete artifact hashes and refusal timings.

## Progress record

### All batches completed

Implemented concrete descriptor-fixture negative proofs for all 245 Goal 21
neighbor profiles. Each Goal 21 negative profile now uses a
`concrete-negative:goal21/<profile>` fixture backed by
`scripts/fixtures/goal21-negative-descriptor-fixtures.json`; no Goal 21 negative
profile still uses `synthetic-negative:goal21/...`. The fixture registry records
the unsupported condition, descriptor version, target refusal gate, expected
refusal code, and descriptor sha256 for every neighbor. The proof runner now
loads these fixtures, emits concrete restore-descriptor artifact provenance, and
checks the same fail-closed refusal contract with `migrationCompleted=false`.

Concrete fixture artifacts:

- fixture registry sha256:
  `b7bd3e4f3c97ccd7eb1d2e295af95b87c4e7ef75529f13762656325def3060b3`;
- proof profile inventory sha256:
  `400560a7983bb43b4cdbe52c3d8ce9c075be047f4cef1f425f3b19e41ed65a4a`.

Validation:

- proof profile schema validation — 0.033s;
- focused proof runner/runtime-support unit tests — 4.099s, 84 tests passed;
- Goal 21 adjacent positive matrix — 1.389s, 49/49 profiles passed;
- Goal 22 concrete negative-neighbor matrix — 6.461s, 245/245 profiles passed;
- combined Goal 21/22 matrix — 7.693s, 294/294 profiles passed;
- refusal matrix — 11.767s, 434/434 refusal profiles passed;
- foundation matrix with checked summaries — 12.953s, 524/524 profiles passed.

Final completion audit:

- final proof profile schema validation — 0.156s;
- final `pnpm run format:check` — 0.695s;
- final `pnpm run lint` — 0.232s;
- final `pnpm run build:docs` — 1.713s;
- final `pnpm run typecheck` — 2.453s;
- final `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.206s;
- final `pnpm exec fallow audit --changed-since origin/main` — 0.425s;
- final `git diff --check` — 0.018s.

Full smoke tests were not run: this change adds concrete descriptor fixtures,
proof-runner fixture loading, proof metadata, tests, and docs. It does not touch
VM/VMM/rootfs/assets/CLI lifecycle, actual snapshot/restore loader behavior,
virtio devices, memory/ballooning, or FUSE/live mounts.

## Validation checklist

Run and record timings as batches land:

- proof profile schema validation;
- focused tests for the changed fixture/descriptor/loader/refusal path;
- each concrete negative profile in the completed batch;
- the adjacent positive Goal 21 profile for the batch;
- Goal 21 negative-neighbor matrix;
- refusal matrix with checked summaries;
- foundation matrix with checked summaries;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run build:docs` if public docs/API change;
- `pnpm run typecheck`;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- `pnpm exec fallow audit --changed-since origin/main`;
- `git diff --check`;
- full smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior is
  touched.

## Final completion criteria

Goal 22 is complete only when:

- all 245 profiles listed above no longer rely on synthetic/profile-only negative
  shortcuts;
- every listed negative has a concrete fixture or explicitly accepted equivalent
  concrete refusal fixture;
- every listed negative passes with the expected refusal code and
  `migrationCompleted=false`;
- all adjacent positives still pass;
- profile inventory, support-envelope docs, matrices, and tests are updated;
- final refusal and foundation matrices pass with checked summaries;
- final validation timings and artifact hashes are recorded here.
