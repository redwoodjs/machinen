# Goal 35.4: Inspector and debugging sessions

Parent: [Goal 35](./goal-035.md).

## Objective

Prove support or stable refusal for Node.js processes with active inspector,
DevTools protocol, profiling, coverage, heap snapshot, or debug-break state.

## Requirements

- [x] Add fixtures for active `--inspect`, attached DevTools protocol client,
      breakpoint pause, CPU profiling, heap snapshot in progress, and coverage
      collection.
- [x] Capture inspector port/listener state, protocol session IDs, pending
      messages, breakpoints, paused frame metadata, and profiling/coverage state
      where support is claimed.
- [x] Restore supported inspector sessions with the debugger client still able to
      resume or query the target after restore.
- [x] Refuse unsupported inspector states with stable codes and
      `migrationCompleted=false`.
- [x] Ensure restored debug state does not expose source text replay or sidecar
      debugger shortcuts.
- [x] Add checked summaries and docs for supported and refused protocol states.

## Validation

- [x] Inspector attached-session restore/refusal smoke.
- [x] Breakpoint pause restore/refusal smoke.
- [x] Profiling/coverage/heap-snapshot refusal tests unless support is proven.
- [x] Security inspection for debugger artifacts and source replay.
- [x] Relevant static checks from Goal 35.

## Completion criteria

Complete when Node inspector/debug states are either target-natively restored for
the claimed subset or refused with stable protocol-state evidence.

## Completion note

Completed as part of umbrella Goal 35. See
[Goal 35 completion validation record](./goal-035.md#completion-validation-record)
for implementation and validation evidence.
