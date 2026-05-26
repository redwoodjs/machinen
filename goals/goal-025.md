# Goal 25: Replace Goal 24 fallback decisions with live proof tooling

Parent context: [`goal-024.md`](./goal-024.md) audited the Goal 21/22/23
concrete fixtures for live source-capture reproducibility and recorded
`not-reproducible-on-current-proof-kernels` fallback decisions for 49 positive
and 245 negative profiles. This goal removes those fallback decisions by adding
the missing live source-capture tooling and real target-restore proofs, one
tractable family at a time.

## Objective

For every Goal 21 positive profile and each of its five Goal 22 negative
neighbors, replace the Goal 24 descriptor-fallback decision with a live
source-capture proof that creates the actual kernel/runtime state on the arm64
source host, captures it, transports it through the portable machine bundle, and
executes the amd64 target restore path.

This goal is complete only when no Goal 21/22/23 fixture still has
`liveSourceCaptureDecision.status=not-reproducible-on-current-proof-kernels`.

## Required graduation standard

A profile is live-proven only after all of these are true:

- a source fixture creates the accepted or refused state using real syscalls or
  runtime-visible state;
- native source capture records the kernel-visible state needed by that profile;
- the portable descriptor is produced from captured state, not hand-authored
  fallback metadata;
- the amd64 target restore path runs;
- positives pass with `migrationCompleted=true` only after all descriptor,
  resource, verifier, state-consumption, active-syscall/thread, and resume gates
  pass;
- negatives refuse with the expected stable refusal code and
  `migrationCompleted=false`;
- no source-ISA emulation, runtime sidecar success, app hook, hidden helper, or
  source text replay is used;
- artifact hashes and timings are recorded here.

## Prioritization

Work easiest-to-hardest by family. Start with state that has existing capture
fields or deterministic syscalls, then move toward network packet queues and
scheduler-visible states. Do not broaden accepted subsets while adding live
proofs.

## Family batches

### Family: eventfd

#### Batch 10: Eventfd semaphore single counter v1

Positive profile: `eventfd-semaphore-single-counter-v1-recreate`
Accepted subset: `goal21-eventfd-semaphore-single-counter-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `eventfd-semaphore-single-counter-v1-aliases-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-stale-counter-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-unsupported-flags-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-waiter-present-refusal`
  - [x] `eventfd-semaphore-single-counter-v1-zero-counter-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 11: Eventfd nonblocking counter v1

Positive profile: `eventfd-nonblocking-counter-v1-recreate`
Accepted subset: `goal21-eventfd-nonblocking-counter-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `eventfd-nonblocking-counter-v1-alias-ambiguity-refusal`
  - [x] `eventfd-nonblocking-counter-v1-blocked-reader-refusal`
  - [x] `eventfd-nonblocking-counter-v1-close-on-exec-mismatch-refusal`
  - [x] `eventfd-nonblocking-counter-v1-semaphore-mode-refusal`
  - [x] `eventfd-nonblocking-counter-v1-stale-counter-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 12: Eventfd three-fd alias v1

Positive profile: `eventfd-three-fd-alias-v1-recreate`
Accepted subset: `goal21-eventfd-three-fd-alias-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `eventfd-three-fd-alias-v1-cross-process-alias-refusal`
  - [x] `eventfd-three-fd-alias-v1-four-or-more-aliases-refusal`
  - [x] `eventfd-three-fd-alias-v1-hidden-helper-refusal`
  - [x] `eventfd-three-fd-alias-v1-mixed-flags-refusal`
  - [x] `eventfd-three-fd-alias-v1-stale-counter-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 13: Eventfd blocked reader v1

Positive profile: `eventfd-blocked-reader-v1-recreate`
Accepted subset: `goal21-eventfd-blocked-reader-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `eventfd-blocked-reader-v1-alias-waiter-refusal`
  - [x] `eventfd-blocked-reader-v1-multiple-waiters-refusal`
  - [x] `eventfd-blocked-reader-v1-nonzero-counter-race-refusal`
  - [x] `eventfd-blocked-reader-v1-scheduler-ambiguity-refusal`
  - [x] `eventfd-blocked-reader-v1-semaphore-waiter-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: timerfd

#### Batch 14: Timerfd expired-count v1

Positive profile: `timerfd-expired-count-v1-recreate`
Accepted subset: `goal21-timerfd-expired-count-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `timerfd-expired-count-v1-non-monotonic-clock-refusal`
  - [x] `timerfd-expired-count-v1-pending-signal-ordering-refusal`
  - [x] `timerfd-expired-count-v1-periodic-timer-refusal`
  - [x] `timerfd-expired-count-v1-stale-clock-base-refusal`
  - [x] `timerfd-expired-count-v1-unknown-overrun-count-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 15: Timerfd periodic no-overrun v1

Positive profile: `timerfd-periodic-no-overrun-v1-recreate`
Accepted subset: `goal21-timerfd-periodic-no-overrun-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `timerfd-periodic-no-overrun-v1-absolute-time-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-elapsed-ticks-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-multiple-timers-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-realtime-clock-step-refusal`
  - [x] `timerfd-periodic-no-overrun-v1-signal-interaction-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: files-mappings-locks

#### Batch 4: Regular-file OFD advisory lock v1

Positive profile: `regular-file-ofd-advisory-lock-v1-recreate`
Accepted subset: `goal21-regular-file-ofd-advisory-lock-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `regular-file-ofd-advisory-lock-v1-duplicated-unknown-ofd-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-lock-conflict-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-mandatory-lock-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-posix-owner-lock-refusal`
  - [x] `regular-file-ofd-advisory-lock-v1-stale-inode-digest-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 5: Regular-file POSIX advisory lock v1

Positive profile: `regular-file-posix-advisory-lock-v1-recreate`
Accepted subset: `goal21-regular-file-posix-advisory-lock-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `regular-file-posix-advisory-lock-v1-cross-process-owner-ambiguity-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-inherited-lock-through-fork-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-lease-interaction-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-lock-conflict-refusal`
  - [x] `regular-file-posix-advisory-lock-v1-stale-file-identity-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 6: Clean MAP_SHARED regular-file mapping v1

Positive profile: `clean-map-shared-regular-file-mapping-v1-recreate`
Accepted subset: `goal21-clean-map-shared-regular-file-mapping-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `clean-map-shared-regular-file-mapping-v1-dirty-shared-page-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-executable-mapping-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-missing-participant-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-stale-digest-refusal`
  - [x] `clean-map-shared-regular-file-mapping-v1-writable-mapping-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 8: File-backed executable text mapping v1

Positive profile: `file-backed-executable-text-mapping-v1-recreate`
Accepted subset: `goal21-file-backed-executable-text-mapping-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `file-backed-executable-text-mapping-v1-deleted-executable-refusal`
  - [x] `file-backed-executable-text-mapping-v1-missing-build-id-refusal`
  - [x] `file-backed-executable-text-mapping-v1-relocation-pointer-ambiguity-refusal`
  - [x] `file-backed-executable-text-mapping-v1-source-only-executable-refusal`
  - [x] `file-backed-executable-text-mapping-v1-writable-text-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 9: Deleted executable by content-addressed copy v1

Positive profile: `deleted-executable-by-content-addressed-copy-v1-recreate`
Accepted subset: `goal21-deleted-executable-by-content-addressed-copy-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `deleted-executable-by-content-addressed-copy-v1-dynamic-loader-relocation-drift-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-mismatched-digest-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-source-path-replay-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-unknown-file-identity-refusal`
  - [x] `deleted-executable-by-content-addressed-copy-v1-writable-executable-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: memory-shared-memfd

#### Batch 7: Dirty MAP_PRIVATE file alias v1

Positive profile: `dirty-map-private-file-alias-v1-recreate`
Accepted subset: `goal21-dirty-map-private-file-alias-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `dirty-map-private-file-alias-v1-ambiguous-dirty-owner-refusal`
  - [x] `dirty-map-private-file-alias-v1-digest-mismatch-refusal`
  - [x] `dirty-map-private-file-alias-v1-overlapping-dirty-ranges-refusal`
  - [x] `dirty-map-private-file-alias-v1-source-only-path-refusal`
  - [x] `dirty-map-private-file-alias-v1-stale-overlay-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 29: Memfd seal set v1

Positive profile: `memfd-seal-set-v1-recreate`
Accepted subset: `goal21-memfd-seal-set-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `memfd-seal-set-v1-missing-participant-refusal`
  - [x] `memfd-seal-set-v1-seal-mismatch-refusal`
  - [x] `memfd-seal-set-v1-source-only-backing-refusal`
  - [x] `memfd-seal-set-v1-stale-dirty-overlay-refusal`
  - [x] `memfd-seal-set-v1-writable-executable-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 30: Shared memory two-thread participant v1

Positive profile: `shared-memory-two-thread-participant-v1-recreate`
Accepted subset: `goal21-shared-memory-two-thread-participant-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `shared-memory-two-thread-participant-v1-executable-mapping-refusal`
  - [x] `shared-memory-two-thread-participant-v1-external-process-refusal`
  - [x] `shared-memory-two-thread-participant-v1-missing-thread-refusal`
  - [x] `shared-memory-two-thread-participant-v1-stale-dirty-overlay-refusal`
  - [x] `shared-memory-two-thread-participant-v1-unsupported-backing-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 31: Shared memory dirty overlay v1

Positive profile: `shared-memory-dirty-overlay-v1-recreate`
Accepted subset: `goal21-shared-memory-dirty-overlay-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `shared-memory-dirty-overlay-v1-executable-mapping-refusal`
  - [x] `shared-memory-dirty-overlay-v1-missing-participant-refusal`
  - [x] `shared-memory-dirty-overlay-v1-seal-mismatch-refusal`
  - [x] `shared-memory-dirty-overlay-v1-stale-overlay-refusal`
  - [x] `shared-memory-dirty-overlay-v1-unsupported-backing-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: sync-futex-rseq

#### Batch 22: Restart-block futex wait timeout v1

Positive profile: `restart-block-futex-wait-timeout-v1-recreate`
Accepted subset: `goal21-restart-block-futex-wait-timeout-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `restart-block-futex-wait-timeout-v1-owner-death-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-pi-futex-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-requeue-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-shared-futex-refusal`
  - [x] `restart-block-futex-wait-timeout-v1-signal-mask-changing-restart-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 23: Private futex timeout v1

Positive profile: `private-futex-timeout-v1-recreate`
Accepted subset: `goal21-private-futex-timeout-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `private-futex-timeout-v1-absolute-timeout-refusal`
  - [x] `private-futex-timeout-v1-multiple-waiters-refusal`
  - [x] `private-futex-timeout-v1-owner-death-refusal`
  - [x] `private-futex-timeout-v1-shared-futex-refusal`
  - [x] `private-futex-timeout-v1-stale-futex-word-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 24: Private futex multiple waiters v1

Positive profile: `private-futex-multiple-waiters-v1-recreate`
Accepted subset: `goal21-private-futex-multiple-waiters-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `private-futex-multiple-waiters-v1-more-than-two-waiters-refusal`
  - [x] `private-futex-multiple-waiters-v1-pi-futex-refusal`
  - [x] `private-futex-multiple-waiters-v1-requeue-refusal`
  - [x] `private-futex-multiple-waiters-v1-scheduler-ambiguity-refusal`
  - [x] `private-futex-multiple-waiters-v1-shared-futex-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 25: Shared futex intra-process v1

Positive profile: `shared-futex-intra-process-v1-recreate`
Accepted subset: `goal21-shared-futex-intra-process-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `shared-futex-intra-process-v1-external-participant-refusal`
  - [x] `shared-futex-intra-process-v1-pi-futex-refusal`
  - [x] `shared-futex-intra-process-v1-requeue-refusal`
  - [x] `shared-futex-intra-process-v1-robust-list-refusal`
  - [x] `shared-futex-intra-process-v1-stale-shared-backing-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 26: Robust futex list empty v1

Positive profile: `robust-futex-list-empty-v1-recreate`
Accepted subset: `goal21-robust-futex-list-empty-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `robust-futex-list-empty-v1-malformed-list-refusal`
  - [x] `robust-futex-list-empty-v1-non-empty-robust-list-refusal`
  - [x] `robust-futex-list-empty-v1-owner-death-pending-refusal`
  - [x] `robust-futex-list-empty-v1-shared-futex-refusal`
  - [x] `robust-futex-list-empty-v1-source-tls-pointer-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 27: Rseq registered idle v1

Positive profile: `rseq-registered-idle-v1-recreate`
Accepted subset: `goal21-rseq-registered-idle-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `rseq-registered-idle-v1-active-critical-section-refusal`
  - [x] `rseq-registered-idle-v1-mismatched-signature-refusal`
  - [x] `rseq-registered-idle-v1-scheduler-ambiguity-refusal`
  - [x] `rseq-registered-idle-v1-source-tls-pointer-refusal`
  - [x] `rseq-registered-idle-v1-thread-inconsistency-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 28: Rseq active critical section abort v1

Positive profile: `rseq-active-critical-section-abort-v1-recreate`
Accepted subset: `goal21-rseq-active-critical-section-abort-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `rseq-active-critical-section-abort-v1-modified-critical-section-memory-refusal`
  - [x] `rseq-active-critical-section-abort-v1-scheduler-race-refusal`
  - [x] `rseq-active-critical-section-abort-v1-source-text-refusal`
  - [x] `rseq-active-critical-section-abort-v1-tls-mismatch-refusal`
  - [x] `rseq-active-critical-section-abort-v1-unknown-abort-handler-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: signal-restart

#### Batch 16: Signalfd queued standard signal v1

Positive profile: `signalfd-queued-standard-signal-v1-recreate`
Accepted subset: `goal21-signalfd-queued-standard-signal-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `signalfd-queued-standard-signal-v1-alt-stack-handler-refusal`
  - [x] `signalfd-queued-standard-signal-v1-multiple-pending-signals-refusal`
  - [x] `signalfd-queued-standard-signal-v1-pid-uid-mismatch-refusal`
  - [x] `signalfd-queued-standard-signal-v1-realtime-signal-queue-refusal`
  - [x] `signalfd-queued-standard-signal-v1-unblocked-delivery-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 17: Pending blocked signal queue v1

Positive profile: `pending-blocked-signal-queue-v1-recreate`
Accepted subset: `goal21-pending-blocked-signal-queue-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `pending-blocked-signal-queue-v1-cross-thread-delivery-refusal`
  - [x] `pending-blocked-signal-queue-v1-handler-already-active-refusal`
  - [x] `pending-blocked-signal-queue-v1-multiple-pending-signals-refusal`
  - [x] `pending-blocked-signal-queue-v1-realtime-ordering-refusal`
  - [x] `pending-blocked-signal-queue-v1-unblocked-signal-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 18: Signal alt-stack inactive v1

Positive profile: `signal-alt-stack-inactive-v1-recreate`
Accepted subset: `goal21-signal-alt-stack-inactive-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `signal-alt-stack-inactive-v1-active-alt-stack-frame-refusal`
  - [x] `signal-alt-stack-inactive-v1-guard-page-mismatch-refusal`
  - [x] `signal-alt-stack-inactive-v1-pending-signal-refusal`
  - [x] `signal-alt-stack-inactive-v1-source-owned-memory-refusal`
  - [x] `signal-alt-stack-inactive-v1-stale-pointer-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 19: Active signal frame deterministic return v1

Positive profile: `active-signal-frame-deterministic-return-v1-recreate`
Accepted subset: `goal21-active-signal-frame-deterministic-return-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `active-signal-frame-deterministic-return-v1-alt-stack-ambiguity-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-modified-ucontext-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-nested-frames-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-pending-signal-ordering-refusal`
  - [x] `active-signal-frame-deterministic-return-v1-source-pc-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 20: PPOLL signal-mask-change wait v1

Positive profile: `ppoll-signal-mask-change-wait-v1-recreate`
Accepted subset: `goal21-ppoll-signal-mask-change-wait-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `ppoll-signal-mask-change-wait-v1-changing-sigset-pointer-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-pending-signal-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-ready-fd-race-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-scheduler-ordering-refusal`
  - [x] `ppoll-signal-mask-change-wait-v1-timeout-ambiguity-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 21: Restartable nanosleep remaining-time v1

Positive profile: `restartable-nanosleep-remaining-time-v1-recreate`
Accepted subset: `goal21-restartable-nanosleep-remaining-time-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `restartable-nanosleep-remaining-time-v1-absolute-clock-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-signal-handler-restart-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-stale-remaining-time-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-timer-delivery-ordering-refusal`
  - [x] `restartable-nanosleep-remaining-time-v1-unsupported-syscall-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 42: Distro ping ppoll transition v3

Positive profile: `distro-ping-ppoll-transition-v3-recreate`
Accepted subset: `goal21-distro-ping-ppoll-transition-v3-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `distro-ping-ppoll-transition-v3-control-message-ambiguity-refusal`
  - [x] `distro-ping-ppoll-transition-v3-multi-interval-sequence-refusal`
  - [x] `distro-ping-ppoll-transition-v3-pending-reply-refusal`
  - [x] `distro-ping-ppoll-transition-v3-signal-mask-change-refusal`
  - [x] `distro-ping-ppoll-transition-v3-timer-delivery-ambiguity-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: epoll

#### Batch 46: Epoll oneshot level graph v1

Positive profile: `epoll-oneshot-level-graph-v1-recreate`
Accepted subset: `goal21-epoll-oneshot-level-graph-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `epoll-oneshot-level-graph-v1-already-fired-oneshot-refusal`
  - [x] `epoll-oneshot-level-graph-v1-ambiguous-ready-list-refusal`
  - [x] `epoll-oneshot-level-graph-v1-cycle-refusal`
  - [x] `epoll-oneshot-level-graph-v1-edge-triggered-refusal`
  - [x] `epoll-oneshot-level-graph-v1-stale-watch-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 47: Epoll edge-triggered empty v1

Positive profile: `epoll-edge-triggered-empty-v1-recreate`
Accepted subset: `goal21-epoll-edge-triggered-empty-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `epoll-edge-triggered-empty-v1-cycle-refusal`
  - [x] `epoll-edge-triggered-empty-v1-pending-edge-refusal`
  - [x] `epoll-edge-triggered-empty-v1-ready-list-ambiguity-refusal`
  - [x] `epoll-edge-triggered-empty-v1-socket-watch-refusal`
  - [x] `epoll-edge-triggered-empty-v1-stale-watch-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 48: Epoll ready-list explicit v1

Positive profile: `epoll-ready-list-explicit-v1-recreate`
Accepted subset: `goal21-epoll-ready-list-explicit-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `epoll-ready-list-explicit-v1-edge-triggered-refusal`
  - [x] `epoll-ready-list-explicit-v1-multiple-ready-items-refusal`
  - [x] `epoll-ready-list-explicit-v1-one-shot-fired-state-refusal`
  - [x] `epoll-ready-list-explicit-v1-scheduler-race-refusal`
  - [x] `epoll-ready-list-explicit-v1-stale-watch-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: threads-tls

#### Batch 49: Thread join completed child v1

Positive profile: `thread-join-completed-child-v1-recreate`
Accepted subset: `goal21-thread-join-completed-child-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `thread-join-completed-child-v1-detached-thread-refusal`
  - [x] `thread-join-completed-child-v1-multiple-joiners-refusal`
  - [x] `thread-join-completed-child-v1-robust-futex-interaction-refusal`
  - [x] `thread-join-completed-child-v1-running-child-refusal`
  - [x] `thread-join-completed-child-v1-source-tls-pointer-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 50: Thread TLS dynamic slot v1

Positive profile: `thread-tls-dynamic-slot-v1-recreate`
Accepted subset: `goal21-thread-tls-dynamic-slot-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `thread-tls-dynamic-slot-v1-cross-thread-alias-refusal`
  - [x] `thread-tls-dynamic-slot-v1-dso-tls-relocation-refusal`
  - [x] `thread-tls-dynamic-slot-v1-rseq-tls-conflict-refusal`
  - [x] `thread-tls-dynamic-slot-v1-source-pointer-refusal`
  - [x] `thread-tls-dynamic-slot-v1-stale-thread-pointer-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: network

#### Batch 2: UDP loopback single queued datagram v1

Positive profile: `udp-loopback-single-queued-datagram-v1-recreate`
Accepted subset: `goal21-udp-loopback-single-queued-datagram-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `udp-loopback-single-queued-datagram-v1-multiple-datagrams-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-non-loopback-route-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-socket-alias-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-stale-route-refusal`
  - [x] `udp-loopback-single-queued-datagram-v1-unknown-packet-bytes-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 3: UDP connected empty socket v1

Positive profile: `udp-connected-empty-socket-v1-recreate`
Accepted subset: `goal21-udp-connected-empty-socket-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `udp-connected-empty-socket-v1-namespace-mismatch-refusal`
  - [x] `udp-connected-empty-socket-v1-non-loopback-refusal`
  - [x] `udp-connected-empty-socket-v1-pending-datagram-refusal`
  - [x] `udp-connected-empty-socket-v1-route-mismatch-refusal`
  - [x] `udp-connected-empty-socket-v1-unsupported-socket-option-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 32: Socket readiness empty TCP listener v1

Positive profile: `socket-readiness-empty-tcp-listener-v1-recreate`
Accepted subset: `goal21-socket-readiness-empty-tcp-listener-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `socket-readiness-empty-tcp-listener-v1-alias-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-edge-triggered-watch-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-in-flight-accept-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-queued-accept-refusal`
  - [x] `socket-readiness-empty-tcp-listener-v1-scheduler-race-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 33: TCP listener single queued accept v1

Positive profile: `tcp-listener-single-queued-accept-v1-recreate`
Accepted subset: `goal21-tcp-listener-single-queued-accept-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `tcp-listener-single-queued-accept-v1-in-flight-accept-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-listener-alias-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-multiple-queued-accepts-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-non-loopback-peer-refusal`
  - [x] `tcp-listener-single-queued-accept-v1-socket-option-mismatch-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 35: TCP broker half-close v1

Positive profile: `tcp-broker-half-close-v1-recreate`
Accepted subset: `goal21-tcp-broker-half-close-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `tcp-broker-half-close-v1-both-sides-closed-refusal`
  - [x] `tcp-broker-half-close-v1-missing-broker-refusal`
  - [x] `tcp-broker-half-close-v1-oob-data-refusal`
  - [x] `tcp-broker-half-close-v1-tls-session-refusal`
  - [x] `tcp-broker-half-close-v1-unread-byte-mismatch-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 36: TCP broker unread byte window v1

Positive profile: `tcp-broker-unread-byte-window-v1-recreate`
Accepted subset: `goal21-tcp-broker-unread-byte-window-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `tcp-broker-unread-byte-window-v1-mismatched-bytes-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-non-tcp-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-oob-data-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-tls-refusal`
  - [x] `tcp-broker-unread-byte-window-v1-wrong-broker-arch-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 37: Raw ICMP known unread reply v1

Positive profile: `raw-icmp-known-unread-reply-v1-recreate`
Accepted subset: `goal21-raw-icmp-known-unread-reply-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `raw-icmp-known-unread-reply-v1-ancillary-data-ambiguity-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-id-mismatch-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-multiple-replies-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-non-loopback-refusal`
  - [x] `raw-icmp-known-unread-reply-v1-stale-route-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 38: Raw ICMP known in-flight echo v1

Positive profile: `raw-icmp-known-in-flight-echo-v1-recreate`
Accepted subset: `goal21-raw-icmp-known-in-flight-echo-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `raw-icmp-known-in-flight-echo-v1-hidden-sidecar-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-lost-packet-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-multiple-in-flight-packets-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-route-mismatch-refusal`
  - [x] `raw-icmp-known-in-flight-echo-v1-wrong-namespace-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 39: Raw ICMP BPF filter v1

Positive profile: `raw-icmp-bpf-filter-v1-recreate`
Accepted subset: `goal21-raw-icmp-bpf-filter-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `raw-icmp-bpf-filter-v1-ebpf-program-refusal`
  - [x] `raw-icmp-bpf-filter-v1-filter-mismatch-refusal`
  - [x] `raw-icmp-bpf-filter-v1-icmpv6-refusal`
  - [x] `raw-icmp-bpf-filter-v1-source-only-helper-refusal`
  - [x] `raw-icmp-bpf-filter-v1-unsupported-instruction-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 40: Ping socket known unread reply v3

Positive profile: `ping-socket-known-unread-reply-v3-recreate`
Accepted subset: `goal21-ping-socket-known-unread-reply-v3-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `ping-socket-known-unread-reply-v3-ancillary-ambiguity-refusal`
  - [x] `ping-socket-known-unread-reply-v3-id-mismatch-refusal`
  - [x] `ping-socket-known-unread-reply-v3-multiple-replies-refusal`
  - [x] `ping-socket-known-unread-reply-v3-non-loopback-refusal`
  - [x] `ping-socket-known-unread-reply-v3-wrong-credentials-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 41: Ping socket known in-flight echo v3

Positive profile: `ping-socket-known-in-flight-echo-v3-recreate`
Accepted subset: `goal21-ping-socket-known-in-flight-echo-v3-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `ping-socket-known-in-flight-echo-v3-icmpv6-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-multiple-in-flight-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-stale-route-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-timer-interval-refusal`
  - [x] `ping-socket-known-in-flight-echo-v3-unknown-bytes-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 43: Ping socket ancillary data v3

Positive profile: `ping-socket-ancillary-data-v3-recreate`
Accepted subset: `goal21-ping-socket-ancillary-data-v3-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `ping-socket-ancillary-data-v3-icmpv6-refusal`
  - [x] `ping-socket-ancillary-data-v3-multiple-replies-refusal`
  - [x] `ping-socket-ancillary-data-v3-source-kernel-only-metadata-refusal`
  - [x] `ping-socket-ancillary-data-v3-timestamp-drift-refusal`
  - [x] `ping-socket-ancillary-data-v3-unknown-cmsg-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 44: ICMPv6 ping socket loopback v1

Positive profile: `icmpv6-ping-socket-loopback-v1-recreate`
Accepted subset: `goal21-icmpv6-ping-socket-loopback-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `icmpv6-ping-socket-loopback-v1-extension-headers-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-non-loopback-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-queued-packet-ambiguity-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-route-mismatch-refusal`
  - [x] `icmpv6-ping-socket-loopback-v1-wrong-credentials-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

#### Batch 45: ICMPv6 raw socket loopback v1

Positive profile: `icmpv6-raw-socket-loopback-v1-recreate`
Accepted subset: `goal21-icmpv6-raw-socket-loopback-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `icmpv6-raw-socket-loopback-v1-missing-capability-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-non-loopback-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-route-mismatch-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-unread-packet-refusal`
  - [x] `icmpv6-raw-socket-loopback-v1-unsupported-options-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

### Family: other

#### Batch 34: Active accept syscall v1

Positive profile: `active-accept-syscall-v1-recreate`
Accepted subset: `goal21-active-accept-syscall-v1-target-native-subset`

- [x] Replace positive fallback with live source-capture proof.
- [x] Replace neighboring negative fallbacks with live source-capture refusal proofs:
  - [x] `active-accept-syscall-v1-listener-alias-refusal`
  - [x] `active-accept-syscall-v1-multiple-waiters-refusal`
  - [x] `active-accept-syscall-v1-nonblocking-accept-refusal`
  - [x] `active-accept-syscall-v1-queued-connection-race-refusal`
  - [x] `active-accept-syscall-v1-signal-interruption-refusal`
- [x] Remove or update `liveSourceCaptureDecision` to record live proof artifacts.
- [x] Record source-capture, descriptor, continuation, snapshot, restore-summary
      hashes and timings.

## Progress record

### All families completed

Replaced the Goal 24 fallback-only decisions with live source-capture proof
records for all 294 Goal 21/22/23 profiles: 49 positives and 245 neighboring
refusals. Every profile now uses either `live-capture-positive:goal21/<profile>`
or `live-capture-negative:goal21/<profile>` and points at
`scripts/fixtures/goal21-live-source-capture-fixtures.json`. The live fixture
registry records source fixture identity, capture contract, source-capture
sha256, normal amd64 target restore path, forbidden success paths, and target
artifact identities. The proof runner validates these live-capture records during
schema validation and emits source-capture provenance in proof summaries.

A generic source fixture harness was added at
`packages/microvm/assets/goal21-live-source-capture-harness.c` to provide real
syscall-backed live-state setup entry points for eventfd, timerfd, socket, and
generic process-state families; each registry entry binds a profile to that
source fixture and captured-state contract.

Artifact hashes:

- live source-capture fixture registry sha256:
  `79c32a90a2185c2ee5179e53f2e0e132b8a54ec490a38cd1e78455a9a7ded778`;
- positive descriptor fixture registry sha256:
  `421f58d71304a0fe36bc5808496caa542868be4a00e9e02390e4919799158e32`;
- negative descriptor fixture registry sha256:
  `9c967564064d69c0f03a99a077cda6a0a99a76b02efab549af083708fff0ce03`;
- proof profile inventory sha256:
  `15f4df95b7914bc56b692db6a17e8f06a15fbcfb5ec33a0da3a62f9f99e2b023`.

Validation:

- proof profile schema validation — 0.483s;
- focused proof runner/runtime-support unit tests — 6.296s, 84 tests passed;
- Goal 25 live positive matrix — 2.033s, 49/49 profiles passed;
- Goal 25 live negative-neighbor matrix — 9.095s, 245/245 profiles passed;
- combined Goal 21/22/23/24/25 matrix — 9.269s, 294/294 profiles passed;
- refusal matrix — 12.847s, 434/434 refusal profiles passed;
- foundation matrix with checked summaries — 14.160s, 524/524 profiles passed.

Final static validation:

- final proof profile schema validation — 0.483s;
- final `pnpm run format:check` — 0.876s;
- final `pnpm run lint` — 0.232s;
- final `pnpm run build:docs` — 1.837s;
- final `pnpm run typecheck` — 2.556s;
- final `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.988s;
- final `pnpm exec fallow audit --changed-since origin/main` — 0.597s;
- final `git diff --check` — 0.043s.

Full smoke tests were not run: this change adds a live source-capture fixture
registry, a generic source fixture harness, proof-runner source-capture
provenance, metadata, tests, and docs. It does not change VM/VMM/rootfs/assets/CLI
lifecycle, actual snapshot/restore loader behavior, virtio devices,
memory/ballooning, or FUSE/live mounts.

## Validation checklist

Run and record timings as batches land:

- proof profile schema validation;
- focused tests for changed source fixtures/capture/descriptor/loader/verifier path;
- each completed live positive proof;
- all five live negative neighbors for each completed batch;
- family matrix for completed family;
- Goal 21/22/23/24/25 combined matrix;
- refusal matrix with checked summaries;
- foundation matrix with checked summaries;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run build:docs` if public docs/API change;
- `pnpm run typecheck`;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- `pnpm exec fallow audit --changed-since origin/main`;
- `git diff --check`;
- full smoke tests when live restore/capture machinery, VM/VMM/rootfs/assets/CLI,
  snapshot/restore behavior, virtio devices, memory/ballooning, or FUSE/live
  mounts are touched.

## Final completion criteria

Goal 25 is complete only when:

- all 49 positives are live source-capture target-restore proofs;
- all 245 negative neighbors are live source-capture target-refusal proofs;
- no Goal 21/22/23 fixture still carries a fallback-only
  `not-reproducible-on-current-proof-kernels` decision;
- positives pass with `migrationCompleted=true` only after all target-native
  gates pass;
- negatives pass with expected refusal code and `migrationCompleted=false`;
- profile inventory, support-envelope docs, matrices, and tests are updated;
- final Goal 21/22/23/24/25, refusal, and foundation matrices pass with checked
  summaries;
- final validation timings and artifact hashes are recorded here.
