# Native thread refusal matrix

This proof keeps unsafe thread states behind precise refusal codes before native
cross-ISA resume can claim support for them.

## Command

```sh
pnpm native-thread-refusal-matrix
```

The proof is host-independent. It builds native process-image thread fixtures and
runs them through the same register translator used by the final-jump proofs.

## What it proves

A thread with `outside-syscall`, no active signal frame, zero signal masks,
disabled alt-stack state, and absent rseq state still translates.

The following unsafe states refuse before register translation:

- `inside-syscall` -> `active-syscall`;
- `restart-block` -> `active-syscall`;
- active signal frame -> `signal-frame-active`;
- non-zero pending signal mask -> `signal-state-unsupported`;
- non-zero blocked signal mask -> `signal-state-unsupported`;
- enabled alt-stack -> `signal-state-unsupported`;
- captured or unsupported rseq state -> `rseq-state-unsupported`;
- unsupported architecture pair -> `architecture-pair-unsupported`.

Zero procfs-style signal masks such as `0000000000000000` remain safe. That keeps
normal ptrace/procfs captures translatable while still refusing real pending or
blocked signal state.

## Boundary

This proof does not implement syscall restart, signal delivery replay, alt-stack
reconstruction, or rseq/TLS migration. It only makes the hard boundary explicit:
those states must not silently pass into final-jump resume until a later proof
models them.
