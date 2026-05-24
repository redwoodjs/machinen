# Native-transparent next frontier

Issue #555 originally selected synthesized target-native blocking syscall
continuations as the next frontier. That ladder has since fed into the portable
machine VM restore proof and the current active frontier is now narrower:
**broaden the class of real processes accepted by the native target-loader path
without weakening fail-closed boundaries**.

## Current proven target-loader point

The target VM proof runs a real amd64 target-native continuation through the
in-guest restore loader. The success path still preserves the Option B
invariants:

- no Node/Bun sidecar runtime;
- no source-ISA emulation;
- no application hooks;
- no captured source text reused as target code;
- unsupported state fails closed with precise refusals.

The following native restore sections are consumed as target-side work before
completion is reported:

| Native section             | Current target-side behavior                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| stack-window writes/guards | writes target stack slots and maps guard pages                                                                                 |
| return-chain writes        | writes bounded target return slots                                                                                             |
| private memory             | maps target private ranges, copies captured bytes, applies final permissions, and backs target TLS/TCB                         |
| executable mapping         | verifies target file/path/address/size/offset, executable/private flags, and build-id or sha256 provenance                     |
| signal restore             | saves, applies, verifies, and restores the loader signal mask                                                                  |
| process context            | carries bounded argv/env/cwd/auxv, applies/verifies env+cwd, and can materialize a bounded target argv/envp/auxv pointer block |
| active syscall             | re-arms modeled sleep/ppoll timers, recreates pipe/eventfd/timerfd read blockers, and completes safe regular-file reads/writes |
| controlled thread spawn    | maps requested stacks and consumes narrow spawn steps with short-lived target tasks                                            |

Recent remote arm64→amd64 proofs now cover:

- pipe, eventfd, timerfd, regular-file active `read`, regular-file active
  `pread64`, and regular-file active `write` profiles with
  `targetActiveSyscallRestoreResult=passed`;
- process-context handoff through the initial-stack pointer block model with
  `targetProcessContextRestoreResult=passed`;
- controlled two-thread restore with futex and rseq still fail-closed behind
  precise refusal detail.

## Remaining frontier

The next work should expand _accepted process shapes_, not relax the success
criteria. Good next issues are:

1. Add more real resource/syscall families one at a time, starting with cases
   whose target fd/resource recipes can be proven without readiness ambiguity.
2. Broaden private target memory coverage only where provenance, permissions,
   guards, and pointer ownership are explicit.
3. Continue process context work beyond the bounded pointer block: model libc
   globals/startup expectations only where target libc, vDSO/vvar, `AT_RANDOM`,
   and `AT_EXECFN` dependencies are explicit.
4. Revisit target libc/vDSO/vvar data dependencies after the syscall/resource
   cases provide comparison points for what must be materialized versus refused.
5. Keep futex wait handoff, rseq resume, arbitrary signal restart, JIT/native
   code migration, and general scheduler state refused until their kernel/user
   ABI contracts are modeled.

## Deferred frontier

Broad target libc/vDSO/vvar materialization, arbitrary signal restart, futex wait
handoff, rseq resume, JIT/native code migration, and general multithread restore
remain deferred. They must keep refusing until their kernel/user ABI contracts
are modeled precisely.

## Validation loop

Native-loader and portable-machine changes should run targeted unit tests plus
full smoke, and remote arm64→amd64 proof when target-loader descriptors,
trampoline consumption, or VM restore completion gates change. Always report
wall-clock timings for validation and remote proof runs.
