# Native active syscall policy

Issue #510 classifies active native syscalls before actual real-utility resume.
The classifier is deliberately fail-closed by default: recognizing a syscall
class does not make it resumable.

## Classes

The current classifier reports:

- `outside-syscall` — safe to continue to later gates;
- `sleep-timer` — `clock_nanosleep` / `nanosleep` style waits;
- `fd-blocking` — `read`, `write`, `poll`, `ppoll`, `select`, `pselect6`, and
  related fd waits;
- `restart` — `restart_syscall` or captured restart-block state;
- `unknown-active` — any active syscall that has not been modeled.

## Refusals

Known blocking syscall classes refuse with precise codes:

- `blocking-syscall-state-unsupported` for sleep/timer and fd-blocking syscalls;
- `target-sleep-remaining-time-missing` when explicit sleep deferral is requested
  but the capture cannot model a relative target timer rearm duration;
- `syscall-restart-unsupported` for restart state;
- `active-syscall` for unknown active syscalls.

`syscall-argument-state-unsupported` remains reserved for syscall argument cases
that are parsed but still cannot prove a safe target continuation.

## Explicit sleep/timer deferral

Issue #512 adds an opt-in `defer-target-resume` policy for sleep/timer syscalls.
This does not mark the syscall as directly resumable. The policy now requires a
modeled relative sleep request timespec from the live syscall arguments and
captured memory. When that model exists, it records a target-resume continuation
with `remainingTime.state: "modeled"` and a conservative
`requested-duration-upper-bound` rearm duration. When the model is missing, it
fails closed with `target-sleep-remaining-time-missing`.

The actual utility proof uses this to move past the `thread-state` gate only when
there is explicit target timer metadata, without pretending that source kernel
state was restored.

## Proof

`pnpm native-active-syscall-policy --json` exercises all current classes and
also shows the explicit sleep/timer deferral policy.
