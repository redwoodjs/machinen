# Native signal restore policy

Issue #645 adds a fail-closed signal boundary for native thread restore.

## Contract

`planNativeSignalRestorePolicy()` accepts empty signal masks by default. With the
explicit `blockedMaskPolicy: "restore-safe-mask"` option, it may also accept and
report a parsed blocked signal mask for target restore.

It still refuses:

- active signal frames (`signal-frame-active`);
- pending signals (`signal-state-unsupported`);
- enabled or unsupported altstack state (`signal-state-unsupported`);
- malformed blocked or pending masks (`signal-state-unsupported`).

The thread restore boundary consumes this policy before allowing a non-empty
blocked mask through the broader execution-state gate. This means safe signal
masks can be restored without weakening active-signal or pending-signal refusal.
