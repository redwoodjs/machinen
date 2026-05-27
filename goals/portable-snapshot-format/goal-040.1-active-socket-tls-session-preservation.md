# Goal 40.1: Live active socket and TLS session preservation

Parent: [Goal 40](./goal-040.md).

## Objective

Determine whether live network state can be portably restored for a narrow,
well-defined subset, or must remain fail-closed. This covers active TCP sockets,
HTTP keep-alive, WebSocket, and TLS session state across Node, Python, Ruby, Go,
and JVM-style services where feasible.

## Requirements

- [x] Add audited fixtures for at least two runtimes, including Go and one
      managed runtime, that hold active network state during snapshot/restore.
- [x] Cover these network classes: - active TCP connection with unread inbound bytes; - HTTP keep-alive connection; - WebSocket or WebSocket-like framed stream; - TLS connection with negotiated session keys; - reconnect-only policy for external peers.
- [x] Decide support vs refusal per state class: - preserve if descriptor, peer, transport, crypto, and replay boundaries
      are all explicit and target-native; - refuse if peer identity, bytes-in-flight, kernel socket queues, TLS key
      material, or replay semantics are ambiguous.
- [x] Record stable refusal codes for unsafe states, including active socket
      queue ambiguity and TLS session key preservation ambiguity.
- [x] Prove positive profiles, if any, with `migrationCompleted=true` and
      target-native verification on both source and target architecture.
- [x] Require `migrationCompleted=false` for every refusal profile.
- [x] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only network continuation.

## Suggested refusal codes

- `runtime-network-active-socket-queue-ambiguous`
- `runtime-network-peer-state-unavailable`
- `runtime-network-bytes-in-flight-unsupported`
- `runtime-network-tls-session-key-opaque`
- `runtime-network-websocket-frame-boundary-ambiguous`
- `runtime-network-reconnect-policy-required`

## Validation

- [x] Active TCP support-or-refusal smoke.
- [x] HTTP keep-alive support-or-refusal smoke.
- [x] WebSocket/framed-stream support-or-refusal smoke.
- [x] TLS session support-or-refusal smoke.
- [x] Cross-architecture route proof for any supported subset.
- [x] Runtime manifest, proof profiles, checked summaries, docs, and matrices.
- [x] Relevant static checks from Goal 40.

## Completion criteria

Complete when active socket/TLS behavior is either proven for a precise portable
subset or fail-closed with stable refusal codes and user-facing guidance.

## Completion record

Completed with `scripts/goal40-hard-runtime-state-proof.mjs`, `scripts/smoke/goal40-hard-runtime-state.sh`, checked summaries in `docs/snapshot/checked-summaries/goal40-hard-state/`, proof profiles, matrix presets, runtime manifest updates, and `docs/snapshot/hard-runtime-state-boundaries.md`. Final validation passed on 2026-05-25.
