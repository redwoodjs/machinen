# Native register/TLS/syscall translation

Issue #445 defines the first arm64 -> amd64 register translation rules for the
transparent native process image path.

## Command

```sh
pnpm native-register-translate
```

The proof translates one safe arm64 thread and refuses one unsafe thread stopped
inside a syscall. The thread-refusal matrix proof expands that boundary across
syscall restart, signal, alt-stack, rseq, and architecture-pair cases.

## Safe point contract

A thread can translate only when all of these are true:

- source architecture is `arm64`;
- target architecture is `amd64`;
- syscall state is `outside-syscall`;
- no signal frame is active;
- pending and blocked signal masks are empty or procfs-style zero masks;
- alternate signal stack state is disabled;
- rseq state is absent;
- a target continuation supplies the translated instruction pointer, stack
  pointer, and TLS base for the thread's captured source PC.

The translator emits an amd64 `targetRegisters` document. It does not copy raw
arm64 register bytes into the target. Continuation metadata may also supply
`targetRegisterOverrides` for values already translated by pointer metadata,
such as an arm64 argument register that must become an amd64 pointer to a target
mapping.

## Refusals

Unsafe states refuse with stable codes:

- `active-syscall` for syscall/restart-block states;
- `signal-frame-active` for active signal trampolines;
- `signal-state-unsupported` for non-zero pending/blocked signal masks or alt-stack state;
- `rseq-state-unsupported` for rseq metadata;
- `code-location-unknown` when the captured PC has no target continuation;
- `architecture-pair-unsupported` for anything other than the initial arm64 ->
  amd64 proof path.

## Boundary

The register translator consumes target continuation addresses and any proven
register-value overrides. It does not compute those addresses itself; #446 owns
source-code to target-code mapping, #447 owns stack layout, and #448 owns
pointer-value classification.
