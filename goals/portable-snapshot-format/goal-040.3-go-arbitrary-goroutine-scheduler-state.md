# Goal 40.3: Arbitrary Go goroutine scheduler state

Parent: [Goal 40](./goal-040.md).

## Objective

Determine whether any portable subset of arbitrary Go goroutine scheduler state
can be restored safely, or whether scheduler-owned state must remain fail-closed
outside bounded, quiescent fixtures.

## Requirements

- [x] Add audited Go fixtures that exercise scheduler-owned state: - runnable goroutines; - parked goroutines; - channel send/receive waiters; - `select` with competing cases; - timers; - goroutine stack growth/shrink; - preemption points; - netpoll waiters.
- [x] Separate bounded supported subsets from unsafe neighboring states. A
      positive subset must have explicit quiescence, deterministic continuation,
      target-native execution, and repeatable semantic verification.
- [x] Refuse arbitrary scheduler queues, ambiguous channel/select state, netpoll
      sockets, goroutine stacks with runtime-private frames, cgo-involved
      goroutines, and TLS/session-coupled goroutines unless proven otherwise.
- [x] Record Go toolchain version, target GOOS/GOARCH, build mode, cgo setting,
      module graph, binary digest, and runtime scheduler evidence.
- [x] Include bidirectional `arm64 <-> amd64` proof for any supported subset.
- [x] Require stable refusal codes and `migrationCompleted=false` for unsupported
      scheduler states.
- [x] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only scheduler claims.

## Suggested refusal codes

- `runtime-go-arbitrary-goroutine-scheduler-unsupported`
- `runtime-go-runnable-queue-ambiguous`
- `runtime-go-parked-goroutine-ambiguous`
- `runtime-go-channel-waiter-ambiguous`
- `runtime-go-select-race-ambiguous`
- `runtime-go-netpoll-waiter-unsupported`
- `runtime-go-runtime-private-frame-unsupported`
- `runtime-go-cgo-goroutine-unsupported`

## Validation

- [x] Runnable goroutine support-or-refusal smoke.
- [x] Parked goroutine support-or-refusal smoke.
- [x] Channel/select support-or-refusal smoke.
- [x] Timer/preemption support-or-refusal smoke.
- [x] Netpoll/cgo refusal matrix.
- [x] Bidirectional cross-architecture proof for any supported subset.
- [x] Runtime manifest, proof profiles, checked summaries, docs, and matrices.
- [x] Relevant static checks from Goal 40.

## Completion criteria

Complete when arbitrary Go scheduler state is either narrowed to a proven,
portable subset or remains explicitly refused with stable codes and clear user
guidance.

## Completion record

Completed with `scripts/goal40-hard-runtime-state-proof.mjs`, `scripts/smoke/goal40-hard-runtime-state.sh`, checked summaries in `docs/snapshot/checked-summaries/goal40-hard-state/`, proof profiles, matrix presets, runtime manifest updates, and `docs/snapshot/hard-runtime-state-boundaries.md`. Final validation passed on 2026-05-25.
