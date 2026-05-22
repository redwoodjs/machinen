# Native active syscall policy

Issue #510 classifies active native syscalls before actual real-utility resume.
The classifier is deliberately fail-closed by default: recognizing a syscall
class does not make it resumable.

## Classes

The current classifier reports:

- `outside-syscall` — safe to continue to later gates;
- `sleep-timer` — `clock_nanosleep` / `nanosleep` style waits;
- `poll-timeout` — modeled `ppoll` timeout waits under an explicit deferral
  policy;
- `fd-blocking` — `read`, `write`, `poll`, `ppoll`, `select`, `pselect6`, and
  related fd waits that are not covered by the narrow `poll-timeout` model;
- `restart` — `restart_syscall` or captured restart-block state;
- `unknown-active` — any active syscall that has not been modeled.

## Refusals

Known blocking syscall classes refuse with precise codes:

- `blocking-syscall-state-unsupported` for sleep/timer and fd-blocking syscalls;
- `target-sleep-remaining-time-missing` when explicit sleep deferral is requested
  but the capture cannot model a relative target timer rearm duration;
- `target-ppoll-timeout-missing` when explicit `ppoll` deferral is requested but
  the capture cannot model the timeout, fd, or signal-mask contract;
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

## Explicit ppoll timeout deferral

The `pollTimeoutPolicy: "defer-target-resume"` option models only relative
`ppoll` timeouts with `sigmask = NULL`. The default `pollTimeoutFdPolicy` is
`"zero-fd-only"`, which accepts only `ppoll(NULL, 0, &timeout, NULL)`.

The optional `"synthetic-empty-pipe"`, `"synthetic-empty-eventfd"`, and
`"synthetic-timerfd"` fd policies accept exactly one captured `struct pollfd`
entry when all of these are true:

- `nfds == 1` and the pollfd array is readable in captured memory;
- the entry is `POLLIN` with `revents == 0`;
- the entry's fd maps to a supported captured resource:
  - pipe: read end only, including read-only fds with extra flags such as
    close-on-exec;
  - eventfd: read/write fd only, counter `0`, and non-semaphore mode;
  - timerfd: read/write fd only, unread `ticks == 0`, non-periodic interval,
    and no absolute `settime` flags;
- the signal mask is still null.

The pipe target recipe creates a fresh empty pipe read end at the same fd and
keeps a write end open. The eventfd target recipe creates a fresh
`eventfd(0, EFD_CLOEXEC)` at the same fd. The timerfd target recipe creates a
fresh disarmed `timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC)` at the same fd.
These preserve timeout-driven proofs
without claiming general fd readiness migration. Missing fd resources, wrong
resource kinds, unsupported flags or state, wrong events, non-empty `revents`,
`nfds > 1`, and non-null signal masks all fail closed as
`target-ppoll-timeout-missing`.

## Proof

`pnpm native-active-syscall-policy --json` exercises all current classes and
also shows the explicit sleep/timer deferral policy.
