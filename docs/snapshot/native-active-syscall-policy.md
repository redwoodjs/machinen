# Native active syscall policy

Issue #510 classifies active native syscalls before actual real-utility resume.
The classifier is deliberately fail-closed: recognizing a syscall class does not
make it resumable.

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
- `syscall-restart-unsupported` for restart state;
- `active-syscall` for unknown active syscalls.

`syscall-argument-state-unsupported` is reserved for later work that parses
syscall arguments but still cannot prove a safe target continuation.

## Proof

`pnpm native-active-syscall-policy --json` exercises all current classes and
shows that each active class remains non-resumable until a later policy models
it explicitly.
