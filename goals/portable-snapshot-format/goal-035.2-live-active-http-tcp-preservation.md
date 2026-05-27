# Goal 35.2: Live active HTTP/TCP connection preservation

Parent: [Goal 35](./goal-035.md).

## Objective

Move beyond Goal 34's active-connection refusal policy and prove preservation of
real in-flight HTTP/TCP connections for a narrow, explicit, verifiable subset.
Anything outside that subset must fail closed with stable refusal codes.

## Requirements

- [x] Add a live HTTP/TCP fixture with an open client connection during capture.
- [x] Preserve and restore socket identity, peer identity, TCP sequence state,
      unread/read buffers, half-close state, and event-loop readiness state for
      the supported subset.
- [x] Verify the original client can continue the same logical request/response
      after target restore, not merely reconnect to a new service.
- [x] Cover HTTP keep-alive, streaming response, request body in flight, and idle
      open socket cases.
- [x] Refuse unsafe neighbors: TLS sessions without key/exporter provenance,
      unverified queued packets, unknown peer identity, NAT/route mismatch,
      half-restored kernel socket state, and cross-host network topology gaps.
- [x] Record packet/socket provenance in checked summaries.

## Validation

- [x] Active HTTP/TCP preservation smoke with in-flight request completion.
- [x] Keep-alive and streaming-response continuation tests.
- [x] Unsafe-neighbor refusal matrix with stable codes.
- [x] Cross-architecture live route validation for every supported case.
- [x] Relevant static checks from Goal 35.

## Completion criteria

Complete when active HTTP/TCP connections are preserved for the claimed subset
across architecture restore, and all unsafe neighboring states fail closed.

## Completion note

Completed as part of umbrella Goal 35. See
[Goal 35 completion validation record](./goal-035.md#completion-validation-record)
for implementation and validation evidence.
