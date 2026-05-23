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
  related fd waits. Narrow pipe/eventfd/timerfd reads and safe offset-backed
  regular-file reads are modeled only under the explicit fd-read deferral
  policy; other fd waits still refuse;
- `restart` — `restart_syscall` or captured restart-block state;
- `unknown-active` — any active syscall that has not been modeled.

## Refusals

Known blocking syscall classes refuse with precise codes:

- `blocking-syscall-state-unsupported` for sleep/timer and generic fd-blocking
  syscalls;
- `target-sleep-remaining-time-missing` when explicit sleep deferral is requested
  but the capture cannot model a relative target timer rearm duration;
- `target-ppoll-timeout-missing` when explicit `ppoll` deferral is requested but
  the capture cannot model the timeout, fd, or signal-mask contract;
- `target-fd-read-state-missing` when explicit fd-read deferral is requested but
  the capture cannot prove a blocking read contract;
- `target-socket-syscall-state-unsupported` for active `accept`, `accept4`, and
  `connect` state;
- `target-epoll-syscall-state-unsupported` for active `epoll_wait`,
  `epoll_pwait`, and `epoll_pwait2` state;
- `target-signalfd-state-unsupported` for active reads from signalfd resources;
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

## Socket accept/connect refusal

Active socket `accept`, `accept4`, and `connect` remain unsupported for native
restore. They now fail closed with `target-socket-syscall-state-unsupported`
instead of the generic fd-blocking refusal. When syscall arguments and the
captured resource table are available, the refusal detail records the socket fd,
resource id/kind/path/flags, and the unsupported kernel state family:

- `connect` needs endpoint identity, in-flight connection result, namespace and
  routing state, and target fd mapping;
- `accept`/`accept4` need listening socket identity, backlog/queued connection
  state, accepted peer endpoint state, and target fd mapping.

Missing arguments, missing resource rows, and non-socket fds remain refusals with
the same code and a specific `detail.reason`. This is refusal tightening only;
no socket syscall is restarted or emulated.

## Epoll/signalfd refusal tightening

Active epoll waits now refuse with
`target-epoll-syscall-state-unsupported`. The refusal records decoded epoll
arguments when available, the captured epoll fd resource when present, and the
unsupported kernel state family: interest list, ready-list ordering,
edge-triggered delivery state, waiter wakeup races, and target fd resource
mapping.

Reads from captured signalfd resources refuse with
`target-signalfd-state-unsupported`. The refusal records the read arguments,
signalfd resource detail, and the unsupported pending signal queue / siginfo
payload / signal-mask coordination state. Missing arguments, missing resource
rows, and wrong resource kinds are still precise fail-closed refusals.

## Explicit fd read deferral

The `fdReadPolicy: "defer-target-resume"` option currently accepts only narrow
blocking `read(fd, buf, count)` cases under an explicit fd resource policy. Every
modeled read requires captured syscall arguments from `/proc/<tid>/syscall` or
source registers and a non-null buffer range contained in captured writable
non-executable memory.

With `fdReadResourcePolicy: "synthetic-empty-pipe"`, the model additionally
requires a captured pipe read-end resource for `fd` and a paired pipe write end
with the same pipe id still open, so the read is not an EOF/readiness ambiguity.

With `fdReadResourcePolicy: "synthetic-empty-eventfd"`, the model requires a
captured eventfd with supported read/write flags, counter `0`, non-semaphore
mode, and `count >= 8`.

With `fdReadResourcePolicy: "synthetic-timerfd"`, the model requires a captured
timerfd with supported read/write flags, `count >= 8`, unread `ticks == 0`,
non-periodic interval, and relative settime state. When captured fdinfo reports a
non-zero remaining timer value, the target step carries that duration so the
trampoline can arm the target timerfd before verifying it still blocks.

With `fdReadResourcePolicy: "reopen-file"`, the model requires a captured
regular-file fd with a reopen recipe, readable access flags, a safe non-negative
file offset, and a translated writable target buffer. The target step uses
bounded `pread()` at the captured offset into the translated buffer and refuses
partial reads; this is an offset-backed completion proof, not a general file or
page-cache migration.

The target step recreates a fresh empty pipe, empty eventfd, or timerfd and
verifies with target-side `poll(POLLIN, timeout=0)` that the read fd would still
block before reporting `nativeActiveSyscallRestore.status=passed`, or completes
the safe regular-file read with target-side `pread()`. Missing arguments, zero
or short counts, missing writable buffer state, wrong resource kind/access,
non-empty eventfds, semaphore mode, unsupported flags, expired or periodic
timerfds, absolute timerfd state, missing paired pipe write ends, unsafe file
offsets, and missing file reopen recipes fail closed as
`target-fd-read-state-missing`.

## Proof

`pnpm native-active-syscall-policy --json` exercises all current classes and
also shows the explicit sleep/timer deferral policy.
