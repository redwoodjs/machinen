# Goal 34.4: Active HTTP/TCP connection policy

Parent: [Goal 34](./goal-034.md).

## Objective

Define and prove the active HTTP/TCP connection policy for live Node restore:
either safe restore of active connections or stable refusal for unsupported active
connection state.

## Requirements

- [x] Add an active HTTP/TCP connection fixture.
- [x] Capture while a connection is open/in-flight.
- [x] Decide support vs refusal based on verifiable socket/packet/state
      provenance.
- [x] If supported, restore and verify the active connection after restore.
- [x] If refused, return a stable refusal code with `migrationCompleted=false`.
- [x] Ensure queued packet, TLS session, half-closed, and peer identity states are
      covered as support or refusal.

## Validation

- [x] Active connection restore-or-refusal smoke.
- [x] Refusal tests for unverified packets and ambiguous peer state.
- [x] Checked summaries for both source routes.
- [x] Full refusal matrix impact if new refusal profiles are added.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when active HTTP/TCP connection behavior is explicitly supported or
refused with stable codes and verified summaries.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
