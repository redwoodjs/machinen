# Native sleep syscall continuation policy

Issue #512 proves one safe path past the `clock_nanosleep` blocker found by the
actual real-utility proof.

## Default behavior

The default policy remains fail-closed. A captured thread inside
`clock_nanosleep` or `nanosleep` refuses before resume with
`blocking-syscall-state-unsupported`.

## Explicit deferral policy

When the proof is run with:

```bash
MACHINEN_ACTUAL_REAL_UTILITY_SLEEP_SYSCALL_POLICY=defer-target-resume \
  pnpm native-actual-real-utility-continuation --json
```

sleep/timer syscalls are converted into a deferred target-resume continuation.
This does not resume source kernel state. It records that target resume must be
delayed by a conservatively re-armed target timer before user code can continue.

Because the policy is explicit, the proof can move past the `thread-state` gate
and reveal the next blocker. For the current actual `/bin/sleep` capture, that
next blocker is expected to be mapping or later continuation metadata, not a
successful resume.

## Non-claims

This policy does not model arbitrary blocking syscalls. It does not make fd
waits, restart blocks, or unknown side-effecting syscalls resumable. It also does
not use source-ISA emulation, source text reuse, app hooks, or sidecars.
