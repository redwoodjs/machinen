# Goal 41.3: Go scheduler refusal contract

Parent: [Goal 41](./goal-041.md).

## Objective

Make Goal 40 arbitrary Go scheduler refusals stable while preserving the bounded
quiescent goroutine/channel/timer subset proven by Goals 39-40.

## Stable refusal codes

- `runtime-go-arbitrary-goroutine-scheduler-unsupported`
- `runtime-go-runnable-queue-ambiguous`
- `runtime-go-parked-goroutine-ambiguous`
- `runtime-go-channel-waiter-ambiguous`
- `runtime-go-select-race-ambiguous`
- `runtime-go-netpoll-waiter-unsupported`
- `runtime-go-runtime-private-frame-unsupported`
- `runtime-go-cgo-goroutine-unsupported`

## Requirements

- [x] Add canonical refusal metadata for each code: message, explanation,
      remediation, and graduation requirements.
- [x] Add fixtures covering: - runnable goroutine queue ambiguity; - parked goroutines; - channel send/receive waiters; - competing `select` cases; - timers with ambiguous wakeup ordering; - netpoll waiters; - runtime-private frames; - cgo-involved goroutines.
- [x] Assert every refusal reports `migrationCompleted=false` and target state
      `refused`.
- [x] Assert the bounded quiescent subset continues to pass and stays distinct
      from arbitrary scheduler-state support.
- [x] Assert no source-ISA emulation, source text replay, sidecar runtime, app
      hook, or metadata-only scheduler claim is accepted.
- [x] Document safe remediation: quiesce goroutines, drain channels, close
      network waiters, avoid cgo, or use application-level restart/reconnect.
- [x] Add matrix coverage that fails on code drift or accidental support.

## Completion criteria

Complete when arbitrary Go scheduler refusals are stable, documented, and covered
by checked summaries and tests without weakening the bounded quiescent positive
subset.
