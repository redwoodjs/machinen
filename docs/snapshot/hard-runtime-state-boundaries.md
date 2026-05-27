# Hard runtime-state boundaries

Goal 40 records the next hard non-Node and cross-runtime states that remain
outside the broad support envelope unless a narrow policy is explicitly proven.

## Validated command

```bash
pnpm smoke-goal40-hard-runtime-state -- --keep --work-dir /tmp/goal40-hard-state
```

## Active sockets and TLS sessions

Supported subset:

- reconnect-only policy for external peers after restore;
- target runtime recreates transport state natively;
- no attempt is made to replay bytes in flight, kernel socket queues, peer
  state, WebSocket frame boundaries, or TLS session keys.

Stable refusals:

- `runtime-network-active-socket-queue-ambiguous`
- `runtime-network-peer-state-unavailable`
- `runtime-network-bytes-in-flight-unsupported`
- `runtime-network-tls-session-key-opaque`
- `runtime-network-websocket-frame-boundary-ambiguous`

## Opaque native extension state

No cgo, JNI, Ruby native-gem, or Python C-extension opaque state is supported by
Goal 40. The proof adds audited shape fixtures and requires an explicit external
state contract before any future positive claim.

Stable refusals:

- `runtime-native-extension-opaque-state`
- `runtime-native-extension-abi-drift`
- `runtime-native-extension-owned-fd-unsupported`
- `runtime-native-extension-background-thread-unsupported`
- `runtime-native-extension-managed-callback-ambiguous`
- `runtime-native-extension-contract-missing`

Future support must prove target-native artifact availability, binary digest,
build ID or equivalent ABI identity, runtime ABI version, contract version, and
reload/rebind verification.

## Go scheduler state

Supported subset:

- bounded quiescent goroutine/channel/timer fixture;
- no cgo;
- deterministic semantic output;
- existing Goal 39 Python/Go cross-architecture route remains the portability
  proof baseline.

Stable refusals:

- `runtime-go-arbitrary-goroutine-scheduler-unsupported`
- `runtime-go-runnable-queue-ambiguous`
- `runtime-go-parked-goroutine-ambiguous`
- `runtime-go-channel-waiter-ambiguous`
- `runtime-go-select-race-ambiguous`
- `runtime-go-netpoll-waiter-unsupported`
- `runtime-go-runtime-private-frame-unsupported`
- `runtime-go-cgo-goroutine-unsupported`

## Matrix presets

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset goal40-hard-state \
  --check-summary-dir docs/snapshot/checked-summaries/goal40-hard-state \
  --json
```

Focused presets:

- `goal40-active-socket-tls`
- `goal40-native-extension`
- `goal40-go-scheduler`
- `goal40-refusal`

## Shortcut policy

Goal 40 rejects source-ISA emulation, source text replay, sidecar runtime
success, app hooks, and metadata-only continuation as support for these states.
