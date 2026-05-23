# Native thread refusal matrix

This proof keeps unsafe thread states behind precise refusal codes before native
cross-ISA resume can claim support for them.

## Command

```sh
pnpm native-thread-refusal-matrix
```

The proof is host-independent. It builds native process-image thread fixtures and
runs them through the same register translator used by the final-jump proofs. It
also runs the target restore thread-boundary planner that now gates portable
machine restore before the target VM is entered.

## What it proves

A single thread with `outside-syscall`, no active signal frame, zero signal
masks, disabled alt-stack state, absent rseq state, known arm64 `TPIDR_EL0`, an
explicit amd64 `%fs`/`%gs` policy, known registers, explicit clean/not-live
SIMD/FPU state, and a private stack still translates and is accepted for the
current restore proof.

The following unsafe states refuse before register translation:

- `inside-syscall` -> `active-syscall`;
- `restart-block` -> `active-syscall`;
- active signal frame -> `signal-frame-active`;
- non-zero pending signal mask -> `signal-state-unsupported`;
- non-zero blocked signal mask -> `signal-state-unsupported`;
- enabled alt-stack -> `signal-state-unsupported`;
- captured or unsupported rseq state -> `rseq-state-unsupported`;
- unsupported architecture pair -> `architecture-pair-unsupported`.

The restore boundary also refuses:

- more than one thread -> `thread-state-unsupported`;
- futex wait resources -> `futex-state-unsupported`;
- signal-delivery stop -> `signal-state-unsupported`;
- ptrace/debug leftovers -> `thread-state-unsupported`;
- shared stack mappings -> `mapping-shared-unsupported`;
- unknown TLS, wrong source thread-pointer register, or unsupported target segment bases -> `tls-state-unsupported`;
- ambiguous PC/SP register state -> `thread-state-unsupported`;
- missing, unsupported, or live SIMD/FPU state -> `simd-fpu-state-unsupported`.

Zero procfs-style signal masks such as `0000000000000000` remain safe. That keeps
normal ptrace/procfs captures translatable while still refusing real pending or
blocked signal state.

## Boundary

This proof does not implement syscall restart, signal delivery replay, alt-stack
reconstruction, rseq/TLS migration, target TCB construction, SIMD/FPU register
restoration, futex replay, ptrace/debug state, or multi-thread restore. It only
makes the hard boundary explicit: those states must not silently pass into
translated frame/resume restore until a later proof models them.
