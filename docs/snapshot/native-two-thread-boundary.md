# Native controlled two-thread boundary

Issue #647 adds a controlled two-thread proof boundary. This is not general
multi-thread migration.

## Contract

`planNativeControlledTwoThreadRestoreBoundary()` accepts exactly two threads only
when each thread independently passes the single-thread restore gates:

- stopped in a ptrace stop;
- known arm64 registers;
- private stack mapping;
- safe TLS and absent rseq;
- clean/not-live SIMD/FPU;
- safe signal state;
- outside active syscalls.

The planner rejects any futex resource before claiming a two-thread restore plan.
It also rejects captured or unsupported rseq state on either thread.

## Refusals

- `thread-state-unsupported` for non-two-thread input or unsafe per-thread state;
- `futex-state-unsupported` for captured futex wait/resource state;
- `rseq-state-unsupported` for captured or unsupported rseq state;
- the underlying single-thread gate's precise refusals for stack, signal,
  register, TLS, SIMD/FPU, or active syscall failures.

This boundary gives us a controlled target for future scheduling/futex work while
keeping ambiguous multi-thread state fail-closed.
