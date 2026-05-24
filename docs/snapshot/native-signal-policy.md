# Native signal restore policy

Issue #645 adds a fail-closed signal boundary for native thread restore.

## Contract

`planNativeSignalRestorePolicy()` accepts empty signal masks by default. With the
explicit `blockedMaskPolicy: "restore-safe-mask"` option, it may also accept and
report a parsed blocked signal mask for target restore.

## Boundary matrix

| Signal state                                     | Current policy                           | Reason                                                                               |
| ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| empty blocked/pending masks                      | accept                                   | no target signal state to recreate                                                   |
| blocked mask with `restore-safe-mask`            | model target mask handoff                | mask bits can be set and verified before target resume                               |
| pending signal queue / siginfo                   | refuse with `signal-state-unsupported`   | queued delivery order, payload ownership, and sender identity are kernel state       |
| active signal frame/trampoline                   | refuse with `signal-frame-active`        | target frame, ucontext, restorer, and interrupted register ownership are not modeled |
| enabled/active alt-stack                         | refuse with `signal-state-unsupported`   | target stack registration and active-frame ownership are not modeled                 |
| malformed blocked/pending masks                  | refuse with `signal-state-unsupported`   | ambiguous source state fails closed                                                  |
| dispositions/handlers beyond controlled defaults | metadata-only/refuse at broader boundary | handler code identity and target libc/kernel registration must be proven before use  |

It still refuses:

- active signal frames (`signal-frame-active`);
- pending signals (`signal-state-unsupported`);
- enabled or unsupported altstack state (`signal-state-unsupported`);
- malformed blocked or pending masks (`signal-state-unsupported`).

The thread restore boundary consumes this policy before allowing a non-empty
blocked mask through the broader execution-state gate. This means safe signal
masks can be restored without weakening active-signal or pending-signal refusal.
