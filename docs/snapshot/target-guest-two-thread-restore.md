# Target guest two-thread restore

Issue #665 plans the controlled two-thread target proof.

`planTargetGuestTwoThreadRestore()` consumes an accepted
`NativeControlledTwoThreadRestorePlan` and two explicit target thread bindings.
It emits one `spawn-target-thread` step per thread with independent target stack
ranges and target register seeds. These steps can now be carried as
`native=thread-spawn` target restore descriptor sections, forwarded by the target
guest loader, and consumed by the amd64 trampoline. The trampoline maps each
requested thread stack and creates a short-lived target task on that stack before
reporting the thread restore section as passed.

The planner refuses when:

- the controlled boundary already refused, including futex/rseq/general thread
  state;
- a target binding is missing, duplicate, or unexpected;
- required `rip`/`rsp` seeds are absent;
- target stack ranges are inverted or overlap.

Issue #693 wires this into the remote portable-machine proof. The remote smoke
captures a real arm64 two-thread process with one user-space spinning thread and
one thread blocked in a modeled `ppoll` timeout, emits `native=thread-spawn`
sections for both controlled target tasks, and requires
`targetThreadRestoreResult=passed` alongside the active-syscall and other native
gates.

This remains a narrow two-thread proof boundary. It proves loader/trampoline
consumption of safe spawn steps only; it is not general multithread restore and
does not accept futex or rseq synchronization state.
