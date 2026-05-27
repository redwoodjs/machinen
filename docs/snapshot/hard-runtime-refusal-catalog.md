# Hard runtime-state refusal catalog

Goal 41 makes the Goal 40 hard-state refusals stable and user-facing. These are
not backlog promises. They are fail-closed contracts that remain in force until a
specific positive proof graduates the state.

## Current behavior

Every Goal 41 refusal summary reports:

- `state=failed` with `targetRestore.state=refused`;
- `migrationCompleted=false`;
- `descriptorGateCompleted=false`;
- no target verifier success;
- no source-ISA emulation, source text replay, sidecar runtime, app hook, or
  metadata-only continuation.

## Active network and TLS

| Code                                                 | Message                                       | Remediation                                                            |
| ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `runtime-network-active-socket-queue-ambiguous`      | Active socket queue cannot be migrated safely | Close/drain sockets before snapshot or use reconnect-after-restore.    |
| `runtime-network-peer-state-unavailable`             | Peer state is unavailable                     | Do not require remote TCP/HTTP peer state to survive restore.          |
| `runtime-network-bytes-in-flight-unsupported`        | Bytes in flight are unsupported               | Quiesce the connection and prove an empty transport boundary.          |
| `runtime-network-tls-session-key-opaque`             | TLS session keys are opaque                   | Reconnect TLS after restore or provide a cryptographic-state contract. |
| `runtime-network-websocket-frame-boundary-ambiguous` | WebSocket frame boundary is ambiguous         | Finish frames before snapshot or reconnect.                            |
| `runtime-network-reconnect-policy-required`          | Reconnect policy is required                  | Configure explicit reconnect-after-restore behavior.                   |

Graduation requires a portable transport descriptor, peer-state contract,
cryptographic/session verifier where applicable, and target-native replay or
reconnect proof.

## Native extensions

| Code                                                     | Message                                  | Remediation                                                         |
| -------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `runtime-native-extension-opaque-state`                  | Native extension state is opaque         | Avoid opaque native state or provide an external-state contract.    |
| `runtime-native-extension-abi-drift`                     | Native extension ABI drift               | Pin runtime ABI and target-native artifact identity.                |
| `runtime-native-extension-build-id-mismatch`             | Native extension build ID mismatch       | Provide matching build ID/digest for the target artifact.           |
| `runtime-native-extension-owned-fd-unsupported`          | Native-owned file descriptor unsupported | Reopen/rebind through an explicit extension contract.               |
| `runtime-native-extension-background-thread-unsupported` | Native background thread unsupported     | Stop native threads before snapshot or prove thread-state handling. |
| `runtime-native-extension-managed-callback-ambiguous`    | Managed callback state is ambiguous      | Prove callback rebind into the managed runtime.                     |
| `runtime-native-extension-contract-missing`              | Native external-state contract missing   | Add a versioned contract with reload/rebind verification.           |

Graduation requires binary path, digest, build ID or ABI identity, runtime ABI,
target-native artifact, external-state contract version, and reload/rebind
verifier.

## Go scheduler

| Code                                                   | Message                                  | Remediation                                              |
| ------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| `runtime-go-arbitrary-goroutine-scheduler-unsupported` | Arbitrary Go scheduler state unsupported | Use the bounded quiescent Go subset.                     |
| `runtime-go-runnable-queue-ambiguous`                  | Go runnable queue is ambiguous           | Quiesce runnable goroutines.                             |
| `runtime-go-parked-goroutine-ambiguous`                | Parked goroutine state is ambiguous      | Drain waits before snapshot.                             |
| `runtime-go-channel-waiter-ambiguous`                  | Go channel waiter is ambiguous           | Drain channels and avoid blocked send/receive.           |
| `runtime-go-select-race-ambiguous`                     | Go select race is ambiguous              | Avoid racing select cases at capture.                    |
| `runtime-go-netpoll-waiter-unsupported`                | Go netpoll waiter unsupported            | Close network waiters or reconnect after restore.        |
| `runtime-go-runtime-private-frame-unsupported`         | Go runtime-private frame unsupported     | Snapshot only at supported application-level boundaries. |
| `runtime-go-cgo-goroutine-unsupported`                 | Go cgo goroutine unsupported             | Avoid cgo or provide a native-state contract.            |

Graduation requires a runtime-versioned scheduler descriptor, target-native
continuation boundary, quiescence/wakeup verifier, and no runtime-private frame
ambiguity.

## Regression coverage

Checked summaries live in `docs/snapshot/checked-summaries/goal41-refusals/`.
Matrix presets:

```bash
node scripts/portable-machine-proof-matrix.mjs --preset goal41-active-network-tls --check-summary-dir docs/snapshot/checked-summaries/goal41-refusals --json
node scripts/portable-machine-proof-matrix.mjs --preset goal41-native-extension --check-summary-dir docs/snapshot/checked-summaries/goal41-refusals --json
node scripts/portable-machine-proof-matrix.mjs --preset goal41-go-scheduler --check-summary-dir docs/snapshot/checked-summaries/goal41-refusals --json
```
