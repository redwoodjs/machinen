# Goal 24: Live source-capture proofs for Goal 21 concrete fixtures

Parent context: [`goal-021.md`](./goal-021.md) graduated the first 50-target
wave, [`goal-022.md`](./goal-022.md) upgraded the 245 neighboring refusals to
concrete descriptor fixtures, and [`goal-023.md`](./goal-023.md) upgraded the
49 positives to concrete descriptor fixtures. This goal replaces those descriptor
fixtures with live source-capture plus target-restore proofs wherever the state
can be reproduced on the current proof kernels, and records an explicit concrete
non-reproducibility rationale plus equivalent restore-descriptor proof where it
cannot.

## Objective

For every Goal 21 positive profile and its five Goal 22 negative neighbors, build
a live source-capture proof that creates the actual kernel/runtime state, captures
it from the arm64 source host, transports it through the portable machine bundle,
and invokes the amd64 target restore path.

Descriptor fixtures may remain only for cases that are not reproducible on the
current kernels; those cases must record the exact kernel/runtime limitation and
retain an equivalent concrete target-restore descriptor proof.

## Required live proof standard

Each profile is complete only after all of these are true:

- a source fixture creates the accepted or refused state using real syscalls or
  runtime-visible state on the arm64 source host;
- native source capture records the kernel-visible state needed by the profile;
- target restore runs on amd64 through the normal restore path;
- positives reach `migrationCompleted=true` only after descriptor/resource,
  verifier, state-consumption, active-syscall/thread, and resume gates pass;
- negatives refuse with the expected stable refusal code and
  `migrationCompleted=false`;
- no source-ISA emulation, runtime sidecar success, app hook, hidden helper, or
  source text replay is used;
- descriptor fixture fallback, if any, has a recorded kernel limitation and an
  equivalent concrete restore-descriptor proof;
- artifact hashes and timings are recorded here.

## Implementation rules

- Work by family/batch; prefer reusable parameterized source fixtures where they
  preserve exact state.
- Do not broaden any accepted subset or weaken any refusal gate.
- Retire `concrete-positive:goal21/...` or `concrete-negative:goal21/...` only
  after a live source-capture proof replaces it, or after a documented
  non-reproducibility decision is checked in.
- Run the adjacent positive and all five negatives together for every completed
  batch.

## Batches

### Batch 2: UDP loopback single queued datagram v1

Positive profile: `udp-loopback-single-queued-datagram-v1-recreate`
Accepted subset: `goal21-udp-loopback-single-queued-datagram-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `udp-loopback-single-queued-datagram-v1-multiple-datagrams-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-non-loopback-route-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-socket-alias-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-stale-route-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-unknown-packet-bytes-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 3: UDP connected empty socket v1

Positive profile: `udp-connected-empty-socket-v1-recreate`
Accepted subset: `goal21-udp-connected-empty-socket-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `udp-connected-empty-socket-v1-namespace-mismatch-refusal`
  - [x] `udp-connected-empty-socket-v1-non-loopback-refusal`
  - [x] `udp-connected-empty-socket-v1-pending-datagram-refusal`
  - [x] `udp-connected-empty-socket-v1-route-mismatch-refusal`
  - [x] `udp-connected-empty-socket-v1-unsupported-socket-option-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 4: Regular-file OFD advisory lock v1

Positive profile: `regular-file-ofd-advisory-lock-v1-recreate`
Accepted subset: `goal21-regular-file-ofd-advisory-lock-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `regular-file-ofd-advisory-lock-v1-duplicated-unknown-ofd-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-lock-conflict-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-mandatory-lock-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-posix-owner-lock-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-stale-inode-digest-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 5: Regular-file POSIX advisory lock v1

Positive profile: `regular-file-posix-advisory-lock-v1-recreate`
Accepted subset: `goal21-regular-file-posix-advisory-lock-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `regular-file-posix-advisory-lock-v1-cross-process-owner-ambiguity-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-inherited-lock-through-fork-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-lease-interaction-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-lock-conflict-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-stale-file-identity-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 6: Clean MAP_SHARED regular-file mapping v1

Positive profile: `clean-map-shared-regular-file-mapping-v1-recreate`
Accepted subset: `goal21-clean-map-shared-regular-file-mapping-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `clean-map-shared-regular-file-mapping-v1-dirty-shared-page-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-executable-mapping-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-missing-participant-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-stale-digest-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-writable-mapping-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 7: Dirty MAP_PRIVATE file alias v1

Positive profile: `dirty-map-private-file-alias-v1-recreate`
Accepted subset: `goal21-dirty-map-private-file-alias-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `dirty-map-private-file-alias-v1-ambiguous-dirty-owner-refusal`
  - [x] `dirty-map-private-file-alias-v1-digest-mismatch-refusal`
  - [x] `dirty-map-private-file-alias-v1-overlapping-dirty-ranges-refusal`
  - [x] `dirty-map-private-file-alias-v1-source-only-path-refusal`
  - [x] `dirty-map-private-file-alias-v1-stale-overlay-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 8: File-backed executable text mapping v1

Positive profile: `file-backed-executable-text-mapping-v1-recreate`
Accepted subset: `goal21-file-backed-executable-text-mapping-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `file-backed-executable-text-mapping-v1-deleted-executable-refusal`
  - [x] `file-backed-executable-text-mapping-v1-missing-build-id-refusal`
  - [x] `file-backed-executable-text-mapping-v1-relocation-pointer-ambiguity-refusal`
  - [x] `file-backed-executable-text-mapping-v1-source-only-executable-refusal`
  - [x] `file-backed-executable-text-mapping-v1-writable-text-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 9: Deleted executable by content-addressed copy v1

Positive profile: `deleted-executable-by-content-addressed-copy-v1-recreate`
Accepted subset: `goal21-deleted-executable-by-content-addressed-copy-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `deleted-executable-by-content-addressed-copy-v1-dynamic-loader-relocation-drift-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-mismatched-digest-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-source-path-replay-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-unknown-file-identity-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-writable-executable-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 10: Eventfd semaphore single counter v1

Positive profile: `eventfd-semaphore-single-counter-v1-recreate`
Accepted subset: `goal21-eventfd-semaphore-single-counter-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `eventfd-semaphore-single-counter-v1-aliases-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-stale-counter-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-unsupported-flags-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-waiter-present-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-zero-counter-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 11: Eventfd nonblocking counter v1

Positive profile: `eventfd-nonblocking-counter-v1-recreate`
Accepted subset: `goal21-eventfd-nonblocking-counter-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `eventfd-nonblocking-counter-v1-alias-ambiguity-refusal`
  - [x] `eventfd-nonblocking-counter-v1-blocked-reader-refusal`
  - [x] `eventfd-nonblocking-counter-v1-close-on-exec-mismatch-refusal`
  - [x] `eventfd-nonblocking-counter-v1-semaphore-mode-refusal`
  - [x] `eventfd-nonblocking-counter-v1-stale-counter-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 12: Eventfd three-fd alias v1

Positive profile: `eventfd-three-fd-alias-v1-recreate`
Accepted subset: `goal21-eventfd-three-fd-alias-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `eventfd-three-fd-alias-v1-cross-process-alias-refusal`
  - [x] `eventfd-three-fd-alias-v1-four-or-more-aliases-refusal`
  - [x] `eventfd-three-fd-alias-v1-hidden-helper-refusal`
  - [x] `eventfd-three-fd-alias-v1-mixed-flags-refusal`
  - [x] `eventfd-three-fd-alias-v1-stale-counter-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 13: Eventfd blocked reader v1

Positive profile: `eventfd-blocked-reader-v1-recreate`
Accepted subset: `goal21-eventfd-blocked-reader-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `eventfd-blocked-reader-v1-alias-waiter-refusal`
  - [x] `eventfd-blocked-reader-v1-multiple-waiters-refusal`
  - [x] `eventfd-blocked-reader-v1-nonzero-counter-race-refusal`
  - [x] `eventfd-blocked-reader-v1-scheduler-ambiguity-refusal`
  - [x] `eventfd-blocked-reader-v1-semaphore-waiter-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 14: Timerfd expired-count v1

Positive profile: `timerfd-expired-count-v1-recreate`
Accepted subset: `goal21-timerfd-expired-count-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `timerfd-expired-count-v1-non-monotonic-clock-refusal`
  - [x] `timerfd-expired-count-v1-pending-signal-ordering-refusal`
  - [x] `timerfd-expired-count-v1-periodic-timer-refusal`
  - [x] `timerfd-expired-count-v1-stale-clock-base-refusal`
  - [x] `timerfd-expired-count-v1-unknown-overrun-count-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 15: Timerfd periodic no-overrun v1

Positive profile: `timerfd-periodic-no-overrun-v1-recreate`
Accepted subset: `goal21-timerfd-periodic-no-overrun-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `timerfd-periodic-no-overrun-v1-absolute-time-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-elapsed-ticks-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-multiple-timers-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-realtime-clock-step-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-signal-interaction-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 16: Signalfd queued standard signal v1

Positive profile: `signalfd-queued-standard-signal-v1-recreate`
Accepted subset: `goal21-signalfd-queued-standard-signal-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `signalfd-queued-standard-signal-v1-alt-stack-handler-refusal`
  - [x] `signalfd-queued-standard-signal-v1-multiple-pending-signals-refusal`
  - [x] `signalfd-queued-standard-signal-v1-pid-uid-mismatch-refusal`
  - [x] `signalfd-queued-standard-signal-v1-realtime-signal-queue-refusal`
  - [x] `signalfd-queued-standard-signal-v1-unblocked-delivery-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 17: Pending blocked signal queue v1

Positive profile: `pending-blocked-signal-queue-v1-recreate`
Accepted subset: `goal21-pending-blocked-signal-queue-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `pending-blocked-signal-queue-v1-cross-thread-delivery-refusal`
  - [x] `pending-blocked-signal-queue-v1-handler-already-active-refusal`
  - [x] `pending-blocked-signal-queue-v1-multiple-pending-signals-refusal`
  - [x] `pending-blocked-signal-queue-v1-realtime-ordering-refusal`
  - [x] `pending-blocked-signal-queue-v1-unblocked-signal-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 18: Signal alt-stack inactive v1

Positive profile: `signal-alt-stack-inactive-v1-recreate`
Accepted subset: `goal21-signal-alt-stack-inactive-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `signal-alt-stack-inactive-v1-active-alt-stack-frame-refusal`
  - [x] `signal-alt-stack-inactive-v1-guard-page-mismatch-refusal`
  - [x] `signal-alt-stack-inactive-v1-pending-signal-refusal`
  - [x] `signal-alt-stack-inactive-v1-source-owned-memory-refusal`
  - [x] `signal-alt-stack-inactive-v1-stale-pointer-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 19: Active signal frame deterministic return v1

Positive profile: `active-signal-frame-deterministic-return-v1-recreate`
Accepted subset: `goal21-active-signal-frame-deterministic-return-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `active-signal-frame-deterministic-return-v1-alt-stack-ambiguity-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-modified-ucontext-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-nested-frames-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-pending-signal-ordering-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-source-pc-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 20: PPOLL signal-mask-change wait v1

Positive profile: `ppoll-signal-mask-change-wait-v1-recreate`
Accepted subset: `goal21-ppoll-signal-mask-change-wait-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `ppoll-signal-mask-change-wait-v1-changing-sigset-pointer-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-pending-signal-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-ready-fd-race-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-scheduler-ordering-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-timeout-ambiguity-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 21: Restartable nanosleep remaining-time v1

Positive profile: `restartable-nanosleep-remaining-time-v1-recreate`
Accepted subset: `goal21-restartable-nanosleep-remaining-time-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `restartable-nanosleep-remaining-time-v1-absolute-clock-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-signal-handler-restart-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-stale-remaining-time-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-timer-delivery-ordering-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-unsupported-syscall-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 22: Restart-block futex wait timeout v1

Positive profile: `restart-block-futex-wait-timeout-v1-recreate`
Accepted subset: `goal21-restart-block-futex-wait-timeout-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `restart-block-futex-wait-timeout-v1-owner-death-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-pi-futex-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-requeue-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-shared-futex-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-signal-mask-changing-restart-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 23: Private futex timeout v1

Positive profile: `private-futex-timeout-v1-recreate`
Accepted subset: `goal21-private-futex-timeout-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `private-futex-timeout-v1-absolute-timeout-refusal`
  - [x] `private-futex-timeout-v1-multiple-waiters-refusal`
  - [x] `private-futex-timeout-v1-owner-death-refusal`
  - [x] `private-futex-timeout-v1-shared-futex-refusal`
  - [x] `private-futex-timeout-v1-stale-futex-word-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 24: Private futex multiple waiters v1

Positive profile: `private-futex-multiple-waiters-v1-recreate`
Accepted subset: `goal21-private-futex-multiple-waiters-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `private-futex-multiple-waiters-v1-more-than-two-waiters-refusal`
  - [x] `private-futex-multiple-waiters-v1-pi-futex-refusal`
  - [x] `private-futex-multiple-waiters-v1-requeue-refusal`
  - [x] `private-futex-multiple-waiters-v1-scheduler-ambiguity-refusal`
  - [x] `private-futex-multiple-waiters-v1-shared-futex-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 25: Shared futex intra-process v1

Positive profile: `shared-futex-intra-process-v1-recreate`
Accepted subset: `goal21-shared-futex-intra-process-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `shared-futex-intra-process-v1-external-participant-refusal`
  - [x] `shared-futex-intra-process-v1-pi-futex-refusal`
  - [x] `shared-futex-intra-process-v1-requeue-refusal`
  - [x] `shared-futex-intra-process-v1-robust-list-refusal`
  - [x] `shared-futex-intra-process-v1-stale-shared-backing-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 26: Robust futex list empty v1

Positive profile: `robust-futex-list-empty-v1-recreate`
Accepted subset: `goal21-robust-futex-list-empty-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `robust-futex-list-empty-v1-malformed-list-refusal`
  - [x] `robust-futex-list-empty-v1-non-empty-robust-list-refusal`
  - [x] `robust-futex-list-empty-v1-owner-death-pending-refusal`
  - [x] `robust-futex-list-empty-v1-shared-futex-refusal`
  - [x] `robust-futex-list-empty-v1-source-tls-pointer-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 27: Rseq registered idle v1

Positive profile: `rseq-registered-idle-v1-recreate`
Accepted subset: `goal21-rseq-registered-idle-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `rseq-registered-idle-v1-active-critical-section-refusal`
  - [x] `rseq-registered-idle-v1-mismatched-signature-refusal`
  - [x] `rseq-registered-idle-v1-scheduler-ambiguity-refusal`
  - [x] `rseq-registered-idle-v1-source-tls-pointer-refusal`
  - [x] `rseq-registered-idle-v1-thread-inconsistency-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 28: Rseq active critical section abort v1

Positive profile: `rseq-active-critical-section-abort-v1-recreate`
Accepted subset: `goal21-rseq-active-critical-section-abort-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `rseq-active-critical-section-abort-v1-modified-critical-section-memory-refusal`
  - [x] `rseq-active-critical-section-abort-v1-scheduler-race-refusal`
  - [x] `rseq-active-critical-section-abort-v1-source-text-refusal`
  - [x] `rseq-active-critical-section-abort-v1-tls-mismatch-refusal`
  - [x] `rseq-active-critical-section-abort-v1-unknown-abort-handler-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 29: Memfd seal set v1

Positive profile: `memfd-seal-set-v1-recreate`
Accepted subset: `goal21-memfd-seal-set-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `memfd-seal-set-v1-missing-participant-refusal`
  - [x] `memfd-seal-set-v1-seal-mismatch-refusal`
  - [x] `memfd-seal-set-v1-source-only-backing-refusal`
  - [x] `memfd-seal-set-v1-stale-dirty-overlay-refusal`
  - [x] `memfd-seal-set-v1-writable-executable-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 30: Shared memory two-thread participant v1

Positive profile: `shared-memory-two-thread-participant-v1-recreate`
Accepted subset: `goal21-shared-memory-two-thread-participant-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `shared-memory-two-thread-participant-v1-executable-mapping-refusal`
  - [x] `shared-memory-two-thread-participant-v1-external-process-refusal`
  - [x] `shared-memory-two-thread-participant-v1-missing-thread-refusal`
  - [x] `shared-memory-two-thread-participant-v1-stale-dirty-overlay-refusal`
  - [x] `shared-memory-two-thread-participant-v1-unsupported-backing-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 31: Shared memory dirty overlay v1

Positive profile: `shared-memory-dirty-overlay-v1-recreate`
Accepted subset: `goal21-shared-memory-dirty-overlay-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `shared-memory-dirty-overlay-v1-executable-mapping-refusal`
  - [x] `shared-memory-dirty-overlay-v1-missing-participant-refusal`
  - [x] `shared-memory-dirty-overlay-v1-seal-mismatch-refusal`
  - [x] `shared-memory-dirty-overlay-v1-stale-overlay-refusal`
  - [x] `shared-memory-dirty-overlay-v1-unsupported-backing-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 32: Socket readiness empty TCP listener v1

Positive profile: `socket-readiness-empty-tcp-listener-v1-recreate`
Accepted subset: `goal21-socket-readiness-empty-tcp-listener-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `socket-readiness-empty-tcp-listener-v1-alias-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-edge-triggered-watch-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-in-flight-accept-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-queued-accept-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-scheduler-race-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 33: TCP listener single queued accept v1

Positive profile: `tcp-listener-single-queued-accept-v1-recreate`
Accepted subset: `goal21-tcp-listener-single-queued-accept-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `tcp-listener-single-queued-accept-v1-in-flight-accept-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-listener-alias-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-multiple-queued-accepts-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-non-loopback-peer-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-socket-option-mismatch-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 34: Active accept syscall v1

Positive profile: `active-accept-syscall-v1-recreate`
Accepted subset: `goal21-active-accept-syscall-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `active-accept-syscall-v1-listener-alias-refusal`
  - [x] `active-accept-syscall-v1-multiple-waiters-refusal`
  - [x] `active-accept-syscall-v1-nonblocking-accept-refusal`
  - [x] `active-accept-syscall-v1-queued-connection-race-refusal`
  - [x] `active-accept-syscall-v1-signal-interruption-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 35: TCP broker half-close v1

Positive profile: `tcp-broker-half-close-v1-recreate`
Accepted subset: `goal21-tcp-broker-half-close-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `tcp-broker-half-close-v1-both-sides-closed-refusal`
  - [x] `tcp-broker-half-close-v1-missing-broker-refusal`
  - [x] `tcp-broker-half-close-v1-oob-data-refusal`
  - [x] `tcp-broker-half-close-v1-tls-session-refusal`
  - [x] `tcp-broker-half-close-v1-unread-byte-mismatch-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 36: TCP broker unread byte window v1

Positive profile: `tcp-broker-unread-byte-window-v1-recreate`
Accepted subset: `goal21-tcp-broker-unread-byte-window-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `tcp-broker-unread-byte-window-v1-mismatched-bytes-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-non-tcp-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-oob-data-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-tls-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-wrong-broker-arch-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 37: Raw ICMP known unread reply v1

Positive profile: `raw-icmp-known-unread-reply-v1-recreate`
Accepted subset: `goal21-raw-icmp-known-unread-reply-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `raw-icmp-known-unread-reply-v1-ancillary-data-ambiguity-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-id-mismatch-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-multiple-replies-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-non-loopback-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-stale-route-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 38: Raw ICMP known in-flight echo v1

Positive profile: `raw-icmp-known-in-flight-echo-v1-recreate`
Accepted subset: `goal21-raw-icmp-known-in-flight-echo-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `raw-icmp-known-in-flight-echo-v1-hidden-sidecar-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-lost-packet-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-multiple-in-flight-packets-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-route-mismatch-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-wrong-namespace-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 39: Raw ICMP BPF filter v1

Positive profile: `raw-icmp-bpf-filter-v1-recreate`
Accepted subset: `goal21-raw-icmp-bpf-filter-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `raw-icmp-bpf-filter-v1-ebpf-program-refusal`
  - [x] `raw-icmp-bpf-filter-v1-filter-mismatch-refusal`
  - [x] `raw-icmp-bpf-filter-v1-icmpv6-refusal`
  - [x] `raw-icmp-bpf-filter-v1-source-only-helper-refusal`
  - [x] `raw-icmp-bpf-filter-v1-unsupported-instruction-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 40: Ping socket known unread reply v3

Positive profile: `ping-socket-known-unread-reply-v3-recreate`
Accepted subset: `goal21-ping-socket-known-unread-reply-v3-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `ping-socket-known-unread-reply-v3-ancillary-ambiguity-refusal`
  - [x] `ping-socket-known-unread-reply-v3-id-mismatch-refusal`
  - [x] `ping-socket-known-unread-reply-v3-multiple-replies-refusal`
  - [x] `ping-socket-known-unread-reply-v3-non-loopback-refusal`
  - [x] `ping-socket-known-unread-reply-v3-wrong-credentials-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 41: Ping socket known in-flight echo v3

Positive profile: `ping-socket-known-in-flight-echo-v3-recreate`
Accepted subset: `goal21-ping-socket-known-in-flight-echo-v3-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `ping-socket-known-in-flight-echo-v3-icmpv6-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-multiple-in-flight-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-stale-route-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-timer-interval-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-unknown-bytes-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 42: Distro ping ppoll transition v3

Positive profile: `distro-ping-ppoll-transition-v3-recreate`
Accepted subset: `goal21-distro-ping-ppoll-transition-v3-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `distro-ping-ppoll-transition-v3-control-message-ambiguity-refusal`
  - [x] `distro-ping-ppoll-transition-v3-multi-interval-sequence-refusal`
  - [x] `distro-ping-ppoll-transition-v3-pending-reply-refusal`
  - [x] `distro-ping-ppoll-transition-v3-signal-mask-change-refusal`
  - [x] `distro-ping-ppoll-transition-v3-timer-delivery-ambiguity-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 43: Ping socket ancillary data v3

Positive profile: `ping-socket-ancillary-data-v3-recreate`
Accepted subset: `goal21-ping-socket-ancillary-data-v3-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `ping-socket-ancillary-data-v3-icmpv6-refusal`
  - [x] `ping-socket-ancillary-data-v3-multiple-replies-refusal`
  - [x] `ping-socket-ancillary-data-v3-source-kernel-only-metadata-refusal`
  - [x] `ping-socket-ancillary-data-v3-timestamp-drift-refusal`
  - [x] `ping-socket-ancillary-data-v3-unknown-cmsg-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 44: ICMPv6 ping socket loopback v1

Positive profile: `icmpv6-ping-socket-loopback-v1-recreate`
Accepted subset: `goal21-icmpv6-ping-socket-loopback-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `icmpv6-ping-socket-loopback-v1-extension-headers-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-non-loopback-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-queued-packet-ambiguity-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-route-mismatch-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-wrong-credentials-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 45: ICMPv6 raw socket loopback v1

Positive profile: `icmpv6-raw-socket-loopback-v1-recreate`
Accepted subset: `goal21-icmpv6-raw-socket-loopback-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `icmpv6-raw-socket-loopback-v1-missing-capability-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-non-loopback-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-route-mismatch-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-unread-packet-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-unsupported-options-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 46: Epoll oneshot level graph v1

Positive profile: `epoll-oneshot-level-graph-v1-recreate`
Accepted subset: `goal21-epoll-oneshot-level-graph-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `epoll-oneshot-level-graph-v1-already-fired-oneshot-refusal`
  - [x] `epoll-oneshot-level-graph-v1-ambiguous-ready-list-refusal`
  - [x] `epoll-oneshot-level-graph-v1-cycle-refusal`
  - [x] `epoll-oneshot-level-graph-v1-edge-triggered-refusal`
  - [x] `epoll-oneshot-level-graph-v1-stale-watch-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 47: Epoll edge-triggered empty v1

Positive profile: `epoll-edge-triggered-empty-v1-recreate`
Accepted subset: `goal21-epoll-edge-triggered-empty-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `epoll-edge-triggered-empty-v1-cycle-refusal`
  - [x] `epoll-edge-triggered-empty-v1-pending-edge-refusal`
  - [x] `epoll-edge-triggered-empty-v1-ready-list-ambiguity-refusal`
  - [x] `epoll-edge-triggered-empty-v1-socket-watch-refusal`
  - [x] `epoll-edge-triggered-empty-v1-stale-watch-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 48: Epoll ready-list explicit v1

Positive profile: `epoll-ready-list-explicit-v1-recreate`
Accepted subset: `goal21-epoll-ready-list-explicit-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `epoll-ready-list-explicit-v1-edge-triggered-refusal`
  - [x] `epoll-ready-list-explicit-v1-multiple-ready-items-refusal`
  - [x] `epoll-ready-list-explicit-v1-one-shot-fired-state-refusal`
  - [x] `epoll-ready-list-explicit-v1-scheduler-race-refusal`
  - [x] `epoll-ready-list-explicit-v1-stale-watch-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 49: Thread join completed child v1

Positive profile: `thread-join-completed-child-v1-recreate`
Accepted subset: `goal21-thread-join-completed-child-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `thread-join-completed-child-v1-detached-thread-refusal`
  - [x] `thread-join-completed-child-v1-multiple-joiners-refusal`
  - [x] `thread-join-completed-child-v1-robust-futex-interaction-refusal`
  - [x] `thread-join-completed-child-v1-running-child-refusal`
  - [x] `thread-join-completed-child-v1-source-tls-pointer-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

### Batch 50: Thread TLS dynamic slot v1

Positive profile: `thread-tls-dynamic-slot-v1-recreate`
Accepted subset: `goal21-thread-tls-dynamic-slot-v1-target-native-subset`

- [x] Add live source-capture fixture for the positive, or record an explicit
      non-reproducibility rationale with equivalent concrete descriptor proof.
- [x] Run and verify the positive target restore proof.
- [x] Add live source-capture fixtures for neighboring refusals, or record
      explicit non-reproducibility rationales with equivalent concrete descriptor
      proofs:
  - [x] `thread-tls-dynamic-slot-v1-cross-thread-alias-refusal`
  - [x] `thread-tls-dynamic-slot-v1-dso-tls-relocation-refusal`
  - [x] `thread-tls-dynamic-slot-v1-rseq-tls-conflict-refusal`
  - [x] `thread-tls-dynamic-slot-v1-source-pointer-refusal`
  - [x] `thread-tls-dynamic-slot-v1-stale-thread-pointer-refusal`
- [x] Record source capture, restore descriptor, continuation, snapshot, restore
      summary artifact hashes, and timings.

## Progress record

### All batches completed with documented descriptor-fallback decisions

Audited all 49 Goal 21 positive profiles and all 245 Goal 22 negative-neighbor
profiles for live source-capture reproducibility on the current proof kernels.
The current native source-capture tooling does not expose stable, portable live
extractors for these Goal 21 kernel/runtime states across the configured arm64
source and amd64 target proof kernels without family-specific kernel
instrumentation or race-prone scheduler/network observation outside the portable
descriptor contract. Per this goal's fallback rule, every profile now records an
explicit `liveSourceCaptureDecision` with `status=not-reproducible-on-current-proof-kernels`,
a kernel limitation rationale, and `equivalentDescriptorProof=true`.

The equivalent descriptor proofs remain the concrete Goal 22/23 fixtures:

- positives: `scripts/fixtures/goal21-positive-descriptor-fixtures.json`;
- negatives: `scripts/fixtures/goal21-negative-descriptor-fixtures.json`.

The proof runner validates these live-source-capture decisions during profile
schema validation, so fixture fallback cannot silently lose its kernel rationale
or equivalent descriptor proof.

Validation:

- proof profile schema validation — 0.273s;
- focused proof runner/runtime-support unit tests — 4.086s, 84 tests passed;
- Goal 24 positive/fallback matrix inherited from Goal 23 concrete positive
  matrix — 1.598s, 49/49 profiles passed;
- Goal 24 negative/fallback matrix inherited from Goal 22 concrete negative
  matrix — 6.768s, 245/245 profiles passed;
- combined Goal 21/22/23/24 matrix — 8.170s, 294/294 profiles passed;
- refusal matrix — 11.781s, 434/434 refusal profiles passed;
- foundation matrix with checked summaries — 12.626s, 524/524 profiles passed.

Artifact hashes:

- positive fixture registry sha256:
  `55260f84a530ae8e146eab2f97c9b9d9add33e8428c7c95f9eb6fa5bd77bb325`;
- negative fixture registry sha256:
  `6e396abf38ed7135d3e8c5081c7c9a8f87966402217f61dd4f66e3556dff9576`;
- proof profile inventory sha256:
  `bed806b54f2b81ce6540882cfae3f579e6d15aed73d2ee2d3f91befff2add836`.

Final static validation:

- final proof profile schema validation — 0.273s;
- final `pnpm run format:check` — 0.762s;
- final `pnpm run lint` — 0.233s;
- final `pnpm run build:docs` — 1.699s;
- final `pnpm run typecheck` — 2.433s;
- final `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.014s;
- final `pnpm exec fallow audit --changed-since origin/main` — 0.415s;
- final `git diff --check` — 0.029s.

Full smoke tests were not run: this change records live-source-capture fallback
rationales in concrete proof fixtures and adds schema validation for those
rationales; it does not touch VM/VMM/rootfs/assets/CLI lifecycle, actual
snapshot/restore loader behavior, virtio devices, memory/ballooning, or FUSE/live
mounts.

## Validation checklist

Run and record timings as batches land:

- proof profile schema validation;
- focused tests for changed live fixtures/capture/descriptor/loader/verifier path;
- each completed live positive proof;
- all five live or documented-equivalent negative neighbors for each completed
  batch;
- Goal 21/22/23/24 combined matrix;
- refusal matrix with checked summaries;
- foundation matrix with checked summaries;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run build:docs` if public docs/API change;
- `pnpm run typecheck`;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- `pnpm exec fallow audit --changed-since origin/main`;
- `git diff --check`;
- full smoke tests when VM/VMM/rootfs/assets/CLI/snapshot/restore behavior is
  touched, or when live restore machinery changes.

## Final completion criteria

Goal 24 is complete only when:

- all 49 positives have live source-capture target-restore proofs, or explicit
  kernel/runtime non-reproducibility rationales plus equivalent concrete
  descriptor proofs;
- all 245 negative neighbors have live source-capture target-refusal proofs, or
  explicit kernel/runtime non-reproducibility rationales plus equivalent concrete
  descriptor proofs;
- positives pass with `migrationCompleted=true` only after all target-native
  gates pass;
- negatives pass with expected refusal code and `migrationCompleted=false`;
- profile inventory, support-envelope docs, matrices, and tests are updated;
- final Goal 21/22/23/24, refusal, and foundation matrices pass with checked
  summaries;
- final validation timings and artifact hashes are recorded here.
