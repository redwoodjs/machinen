# Native active syscall policy

Issue #510 classifies active native syscalls before actual real-utility resume.
The classifier is deliberately fail-closed by default: recognizing a syscall
class does not make it resumable. The full thread-restore boundary may consume
an explicitly modeled `defer-target-resume` continuation for sleep/ppoll timeout
state, but only after the same TLS/register/SIMD/stack/resource gates pass.

## Classes

The current classifier reports:

- `outside-syscall` — safe to continue to later gates;
- `sleep-timer` — `clock_nanosleep` / `nanosleep` style waits;
- `poll-timeout` — modeled `ppoll` timeout waits under an explicit deferral
  policy;
- `fd-blocking` — `read`, `write`, `poll`, `ppoll`, `select`, `pselect6`, and
  related fd waits. A narrow pipe `read` subset is modeled only under the
  explicit fd-read deferral policy; other fd waits still refuse;
- `restart` — `restart_syscall` or captured restart-block state;
- `unknown-active` — any active syscall that has not been modeled.

## Refusals

Known blocking syscall classes refuse with precise codes:

- `blocking-syscall-state-unsupported` for sleep/timer and fd-blocking syscalls;
- `target-sleep-remaining-time-missing` when explicit sleep deferral is requested
  but the capture cannot model a relative target timer rearm duration;
- `target-ppoll-timeout-missing` when explicit `ppoll` deferral is requested but
  the capture cannot model the timeout, fd, or signal-mask contract;
- `target-fd-read-state-missing` when explicit fd-read deferral is requested but
  the capture cannot prove a blocking read contract;
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

The actual utility proof and thread-restore boundary use this to move past the
`thread-state` gate only when there is explicit target timer metadata, without
pretending that source kernel state was restored.

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
These preserve timeout-driven proofs without claiming general fd readiness
migration. Missing fd resources, wrong resource kinds, unsupported flags or
state, wrong events, non-empty `revents`, `nfds > 1`, and non-null signal masks
all fail closed as `target-ppoll-timeout-missing`.

## Explicit pipe read deferral

The `fdReadPolicy: "defer-target-resume"` option currently accepts only a
positive-count `read(fd, buf, count)` from a captured pipe read end under
`fdReadResourcePolicy: "synthetic-empty-pipe"`. The model requires:

- captured syscall arguments from `/proc/<tid>/syscall` or source registers;
- a non-null buffer range contained in captured writable non-executable memory;
- a captured pipe read-end resource for `fd`;
- a paired pipe write end with the same pipe id still open, so the read is not an
  EOF/readiness ambiguity.

The target step recreates a fresh empty pipe and verifies with target-side
`poll(POLLIN, timeout=0)` that the read fd would still block before reporting
`nativeActiveSyscallRestore.status=passed`. Missing arguments, zero counts,
missing writable buffer state, wrong resource kind/access, and missing paired
write ends fail closed as `target-fd-read-state-missing`.

## Proof

`pnpm native-active-syscall-policy --json` exercises all current classes and
also shows the explicit sleep/timer deferral policy.
