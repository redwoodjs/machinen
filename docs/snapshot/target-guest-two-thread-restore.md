# Target guest two-thread restore

Issue #665 plans the controlled two-thread target proof.

`planTargetGuestTwoThreadRestore()` consumes an accepted
`NativeControlledTwoThreadRestorePlan` and two explicit target thread bindings.
It emits one `spawn-target-thread` step per thread with independent target stack
ranges and target register seeds.

The planner refuses when:

- the controlled boundary already refused, including futex/rseq/general thread
  state;
- a target binding is missing, duplicate, or unexpected;
- required `rip`/`rsp` seeds are absent;
- target stack ranges are inverted or overlap.

This remains a narrow two-thread proof boundary. It is not general multithread
restore and does not accept futex or rseq synchronization state.
