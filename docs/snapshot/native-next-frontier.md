# Native-transparent next frontier

Issue #555 originally selected synthesized target-native blocking syscall
continuations as the next frontier. That ladder has since fed into the portable
machine VM restore proof and the current active frontier is now narrower:
**broaden the class of real processes accepted by the native target-loader path
without weakening fail-closed boundaries**.

## Current proven target-loader point

The target VM proof now runs a real amd64 target-native continuation through the
in-guest restore loader. The success path still preserves the Option B
invariants:

- no Node/Bun sidecar runtime;
- no source-ISA emulation;
- no application hooks;
- no captured source text reused as target code;
- unsupported state fails closed with precise refusals.

The following native restore sections are consumed as target-side work before
completion is reported:

| Native section             | Current target-side behavior                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| stack-window writes/guards | writes target stack slots and maps guard pages                                                             |
| return-chain writes        | writes bounded target return slots                                                                         |
| private memory             | maps target private ranges, copies captured bytes, applies final permissions, and backs target TLS/TCB     |
| executable mapping         | verifies target file/path/address/size/offset, executable/private flags, and build-id or sha256 provenance |
| signal restore             | saves, applies, verifies, and restores the loader signal mask                                              |
| active syscall             | arms target-side timerfds for modeled sleep/ppoll timeout continuations                                    |
| controlled thread spawn    | maps requested stacks and consumes narrow spawn steps with short-lived target tasks                        |

The latest remote arm64→amd64 proof completed with native target execution and
passed stack, private-memory, executable, signal, register, frame, RFLAGS, TLS,
state-consumption, and return-chain gates.

## Remaining frontier

The next work should expand _accepted process shapes_, not relax the success
criteria. Good next issues are:

1. Feed modeled active-syscall continuations from captured real processes into
   the combined portable VM proof so `targetActiveSyscallRestoreResult=passed`
   appears in an end-to-end VM run, not only focused trampoline proof.
2. Connect controlled two-thread planner output to a real two-thread portable
   bundle/proof case while continuing to refuse futex/rseq/general scheduler
   state.
3. Broaden private target memory coverage only where provenance, permissions,
   guards, and TLS/vDSO/libc dependencies are explicit.
4. Keep expanding real utility coverage one resource/syscall family at a time.

## Deferred frontier

Broad target libc/vDSO/vvar materialization, arbitrary signal restart, futex wait
handoff, rseq state, JIT/native code migration, and general multithread restore
remain deferred. They must keep refusing until their kernel/user ABI contracts
are modeled precisely.

## Validation loop

Native-loader and portable-machine changes should run targeted unit tests plus
full smoke, and remote arm64→amd64 proof when target-loader descriptors,
trampoline consumption, or VM restore completion gates change. Always report
wall-clock timings for validation and remote proof runs.
