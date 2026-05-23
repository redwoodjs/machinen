# Target guest active-syscall restore

Issue #663 plans target re-arm for modeled active syscall continuations. Issue
#691 carries those planned steps into the full portable machine VM proof.

`planTargetGuestActiveSyscallRestore()` consumes the active syscall
classification result. If classification contains any refusal, target restore is
refused. Otherwise, modeled continuations become target steps:

- `rearm-sleep-timer` for modeled `nanosleep`/`clock_nanosleep` remaining time;
- `rearm-ppoll-timeout` for modeled `ppoll` timeout continuations, including
  the synthetic target resources required by the policy;
- `restore-fd-read-block` for narrow modeled pipe, eventfd, and timerfd reads;
- `complete-fd-read-from-file` for safe regular-file reads whose fd has a
  reopen recipe, readable flags, a safe captured offset, and a translated target
  read buffer.

Only continuations that already passed the active-syscall policy are accepted.
Generic blocking syscalls, restart state, missing timespecs, missing read-buffer
state, signalfd reads, epoll waits, socket accept/connect, and unsupported fd
state continue to fail closed before target re-arm with resource-specific
detail.

The target amd64 trampoline now executes these sections by creating and arming a
short-lived target-side timerfd for each `rearm-sleep-timer` or
`rearm-ppoll-timeout` step before entering the restored continuation. For
`restore-fd-read-block`, it recreates the target pipe, eventfd, or timerfd read
fd. Timerfd read steps arm the target timer when modeled remaining time is
present. The trampoline then verifies the fd would still block with a
zero-timeout `poll(POLLIN)`. For `complete-fd-read-from-file`, it performs a
bounded `pread()` from the reopened target fd at the captured offset into the
translated target read buffer, and refuses partial reads. The trampoline reports
`nativeActiveSyscallRestore.status=passed` only when every step was parsed,
validated, and consumed; malformed durations, unknown actions, wrong resume
modes, unsupported sleep syscall names, unsupported `ppoll` resource shapes, and
read fds that are ready/EOF/invalid exit before target success.

The remote portable-machine smoke path captures either the default real arm64
two-thread process with one thread blocked in a modeled `ppoll` timeout or, with
`PORTABLE_MACHINE_REMOTE_SOURCE_TARGET=pipe-read` / `eventfd-read` /
`timerfd-read` / `file-read`, a real arm64 process stopped in `read` on an empty
pipe, eventfd, timerfd, or a safe offset-backed regular file. The file-read
profile uses a ptrace syscall-entry stop for fd 38 so the capture is inside the
`read(fd, buf, count)` boundary; the target proof then completes the read with
`pread()` and the target-native verifier checks the translated read buffer
contains the expected bytes. It wraps that bundle in a portable machine
snapshot, serializes a `native=active-syscall` section in the combined target
descriptor, and requires `targetActiveSyscallRestoreResult=passed` before the
remote arm64→amd64 proof is accepted. Missing or unreadable timeout/read-buffer
memory still refuses before VM target success with the active-syscall refusal
codes.
