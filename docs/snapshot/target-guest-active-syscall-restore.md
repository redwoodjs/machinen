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
