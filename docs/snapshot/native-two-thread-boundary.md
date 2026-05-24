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
It also rejects active futex syscalls with futex-specific detail and captured or
unsupported rseq state on either thread.

## Refusals

- `thread-state-unsupported` for non-two-thread input or unsafe per-thread state;
- `futex-state-unsupported` for captured futex wait/resource state or active
  futex wait syscalls; refusal detail records the resource/syscall and the
  missing futex model pieces;
- `rseq-state-unsupported` for captured or unsupported rseq state; refusal
  detail records the thread rseq state and the missing target rseq lifecycle,
  critical-section abort IP, and TLS ownership model;
- the underlying single-thread gate's precise refusals for stack, signal,
  register, TLS, SIMD/FPU, or active syscall failures.

## Futex, rseq, and scheduler requirements

General futex migration remains refused until a target model can prove all of the
following at once:

- the futex word address is translated and belongs to target-owned memory;
- wait-queue membership, wake/requeue ordering, priority-inheritance state, and
  robust-list owner-death behavior are known;
- timeout and signal interruption semantics match the target restart policy;
- every participating thread's scheduling relationship is represented.

General rseq migration remains refused until the target can register a new rseq
area, translate any active critical-section abort IP, prove whether execution is
inside a critical section, and tie the rseq area to the target TLS/TCB owner.
Captured or unsupported rseq state therefore fails closed with
`rseq-state-unsupported`.

The controlled two-thread proof intentionally avoids those states. Its target
spawns are short-lived verifier tasks with independent stacks/registers/TLS and
no futex wait, rseq, or scheduler handoff. Any future proof that accepts
multithread/futex/rseq state must add a new remote profile and keep all other
scheduler state refused until modeled.

This boundary gives us a controlled target for future scheduling/futex work while
keeping ambiguous multi-thread state fail-closed.
