# Goal 41.1: Active network/TLS refusal contract

Parent: [Goal 41](./goal-041.md).

## Objective

Make Goal 40 active socket/TLS refusals stable, explicit, and regression-tested.
These states remain unsupported unless a future positive proof provides a full
portable transport and cryptographic-state contract.

## Stable refusal codes

- `runtime-network-active-socket-queue-ambiguous`
- `runtime-network-peer-state-unavailable`
- `runtime-network-bytes-in-flight-unsupported`
- `runtime-network-tls-session-key-opaque`
- `runtime-network-websocket-frame-boundary-ambiguous`
- `runtime-network-reconnect-policy-required`

## Requirements

- [ ] Add canonical refusal metadata for each code: message, explanation,
      remediation, and graduation requirements.
- [ ] Add fixtures covering: - active TCP socket with unread inbound bytes; - bytes in flight; - HTTP keep-alive peer state; - WebSocket/framed stream boundary ambiguity; - TLS session keys and replay window opacity; - missing reconnect policy.
- [ ] Assert every refusal reports: - `migrationCompleted=false`; - target state `refused`; - no target verifier success; - no source-ISA emulation; - no source text replay; - no sidecar runtime; - no app hook; - no metadata-only continuation.
- [ ] Document safe remediation: close/drain sockets before snapshot, use
      reconnect-after-restore policy, or provide an explicit future transport
      contract.
- [ ] Add matrix coverage that fails on code drift or accidental support.

## Completion criteria

Complete when each active network/TLS refusal has durable checked summaries,
proof profiles, docs, and regression tests.
