# Native active-syscall refusal proof

Issue #492 makes the real-utility boundary fail closed before code or mapping resume work when a captured thread is stopped inside a syscall.

## Why this matters

A thread blocked in a syscall does not have only user-register state. The kernel may hold restart state, partial side effects, timeout accounting, signal interruption state, or architecture-specific syscall ABI details. Translating that as if the thread were at a normal user-space instruction would be unsafe.

## Capture rule

The native Linux capturer now records per-thread syscall state from kernel metadata while the thread is ptrace-stopped:

- `/proc/<tid>/syscall` with syscall number `-1` becomes `outside-syscall`.
- A non-negative syscall number becomes `inside-syscall` with `number` and best-effort `name`.
- `restart_syscall` becomes `restart-block`.
- If syscall metadata cannot be read, capture fails closed as `inside-syscall`.

`translateNativeRegisterState()` already refuses both `inside-syscall` and `restart-block` with `active-syscall`, so real utility attempts now hit the thread-state boundary before any target-code fallback.

## Real utility result

The real utility proof captures:

```sh
sleep 30
```

On arm64 Linux, this is expected to be blocked in `clock_nanosleep`/`nanosleep`. The summary therefore reports:

```json
{
  "blockingBoundary": "thread-state",
  "blockingRefusal": { "code": "active-syscall" },
  "attemptedResume": false,
  "sourceTextReusedAsTargetCode": false
}
```

## Controlled proofs

Controlled final-jump and process-capture targets spin in user space. They should continue to record `outside-syscall`, which keeps their register-translation proofs valid.

## Non-goal

This does not replay syscalls or restart blocks. It only makes the refusal precise and earlier in the pipeline.
