# Go quiescent runtime support expansion

Goal 42 expands Go support beyond the minimal Goal 40 scheduler boundary. It
supports only explicitly quiescent, target-native, no-cgo states and keeps unsafe
scheduler/netpoll neighbors refused.

## Validated command

```bash
pnpm smoke-go-quiescent-runtime -- --keep --work-dir /tmp/goal42-go --iterations 3
```

Default route hosts:

- arm64: `friend@100.126.46.90`
- amd64: `root@192.168.0.8`

## Supported Go quiescent subsets

Each subset is proven bidirectionally across `arm64 <-> amd64` with repeated
semantic fingerprints and target-native static Linux binaries (`CGO_ENABLED=0`).

- **Quiesced HTTP service** — listener is closed before restore and recreated on
  the target; active netpoll sockets remain refused.
- **Drained worker pool** — jobs channel is closed, workers have joined, and
  deterministic results are verified.
- **Drained channels** — buffered values are consumed and the channel is closed;
  no send/receive waiter remains.
- **Deterministic timers** — expired/stopped timer states are verified; ambiguous
  pending wakeup ordering remains refused.

## Go quiescence contract

A positive Goal 42 Go profile requires:

- no goroutine blocked on channel send/receive;
- no pending `select` race;
- no active netpoll waiters;
- timers are stopped, expired, or serializable;
- no cgo;
- no runtime-private stack continuation;
- no source-ISA emulation, source text replay, sidecar runtime, app hook, or
  metadata-only shortcut.

## Stable unsafe-neighbor refusals

- `runtime-go-netpoll-waiter-unsupported`
- `runtime-go-channel-waiter-ambiguous`
- `runtime-go-select-race-ambiguous`
- `runtime-go-cgo-goroutine-unsupported`
- `runtime-go-runtime-private-frame-unsupported`
- `runtime-go-arbitrary-goroutine-scheduler-unsupported`

## Matrix presets

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset go-quiescent-runtime \
  --check-summary-dir docs/snapshot/checked-summaries/go-quiescent-runtime \
  --json
```

Focused presets:

- `go-quiescent-positive`
- `go-quiescent-refusal`
