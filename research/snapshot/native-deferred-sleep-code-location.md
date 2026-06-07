# Native deferred sleep code-location policy

Issue #516 lets the target-code-location gate consume the explicit sleep/timer
continuation metadata from #512.

## Default behavior

Active syscalls still refuse before target code mapping by default. A thread in
`clock_nanosleep` without a deferred continuation produces `active-syscall` at
the target-code-location gate.

## Explicit deferred sleep path

When a thread has a `sleep-timer` continuation with
`action: "defer-target-resume"`, code-location mapping may move past the generic
`active-syscall` refusal and use the captured PC for normal module/RVA matching.
If a target module is available, the result records a deferred active syscall
landing:

- thread id;
- source PC;
- target address;
- syscall class and syscall metadata;
- conservative timer re-arm policy.

This does not resume the source syscall. It only proves where target-native code
would continue after the target timer policy is satisfied. If no explicit target
module matches, the proof now refuses precisely with `target-module-missing`
instead of falling back to `active-syscall`.

## Boundary

Fd-blocking, restart, unknown, or missing continuation states still fail closed.
The policy does not use source-ISA emulation, source text reuse, sidecars, or app
hooks.
