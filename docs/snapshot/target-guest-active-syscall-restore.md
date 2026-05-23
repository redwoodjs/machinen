# Target guest active-syscall restore

Issue #663 plans target re-arm for modeled active syscall continuations.

`planTargetGuestActiveSyscallRestore()` consumes the active syscall
classification result. If classification contains any refusal, target restore is
refused. Otherwise, modeled continuations become target steps:

- `rearm-sleep-timer` for modeled `nanosleep`/`clock_nanosleep` remaining time;
- `rearm-ppoll-timeout` for modeled `ppoll` timeout continuations, including
  the synthetic target resources required by the policy.

Only continuations that already passed the active-syscall policy are accepted.
Generic blocking syscalls, restart state, missing timespecs, and unsupported fd
state continue to fail closed before target re-arm.

The target amd64 trampoline now executes these sections by creating and arming a
short-lived target-side timerfd for each `rearm-sleep-timer` or
`rearm-ppoll-timeout` step before entering the restored continuation. The
trampoline reports `nativeActiveSyscallRestore.status=passed` only when every
step was parsed, validated, and armed; malformed durations, unknown actions,
wrong resume modes, unsupported sleep syscall names, and unsupported `ppoll`
resource shapes exit before target success.
