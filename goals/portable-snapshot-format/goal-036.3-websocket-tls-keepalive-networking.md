# Goal 36.3: WebSocket, TLS, and HTTP keep-alive networking

Parent: [Goal 36](./goal-036.md).

## Objective

Expand network complexity beyond the narrow Goal 35 active HTTP/TCP subset to
WebSockets, TLS, HTTP keep-alive pools, and reconnect-vs-preserve policy.

## Requirements

- [x] Add WebSocket server/client fixture with open connection and in-flight
      message at capture time.
- [x] Add TLS server/client fixture with active session, certificate identity,
      key/exporter provenance, and unsafe-neighbor refusals.
- [x] Add HTTP keep-alive pool fixture with idle and active sockets.
- [x] Decide preserve vs reconnect policy per protocol state, and prove the
      chosen behavior with original-client or target-client verification.
- [x] Record socket, peer, packet, TLS, certificate, session, and route
      provenance in checked summaries.
- [x] Refuse opaque TLS sessions, unknown peer identity, queued packets without
      target verification, NAT/route mismatch, half-restored sockets, and
      protocol state that cannot be replayed safely.

## Validation

- [x] WebSocket preserve-or-refuse smoke.
- [x] TLS preserve-or-refuse smoke.
- [x] HTTP keep-alive pool restore/refusal smoke.
- [x] Unsafe-neighbor network refusal matrix.
- [x] Network checked summaries and matrix presets.
- [x] Relevant static checks from Goal 36.

## Completion criteria

Complete when complex Node networking is preserved for explicit subsets or
refused with stable socket/protocol evidence.

## Completion note

Completed as part of umbrella Goal 36. See
[Goal 36 completion validation record](./goal-036.md#completion-validation-record)
for implementation and validation evidence.
