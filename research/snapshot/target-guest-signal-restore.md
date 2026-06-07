# Target guest signal restore

Issue #661 plans the target-side signal mask handoff.

`planTargetGuestSignalRestore()` consumes an accepted
`NativeSignalRestorePolicyResult` and emits loader steps in this order:

1. save the loader/host signal mask;
2. apply the restored blocked mask with `sigprocmask`;
3. verify the target blocked mask;
4. restore the loader/host signal mask after proof execution.

Refused source signal policy results remain refused and cannot reach target
handoff. Non-empty masks are accepted only when the signal policy already chose
`restore-safe-mask`; pending signals, active signal frames, active alt-stacks,
and malformed masks continue to fail closed before this step.
