# Target guest native restore sections

Issue #669 extends the target guest restore descriptor with optional native
restore sections.

The descriptor can now carry line-oriented `native=` entries for:

- stack-window u64 writes and stack guard ranges;
- bounded return-chain frame writes;
- private-memory restore steps;
- target executable mapping provenance steps;
- signal-mask restore steps;
- modeled active-syscall re-arm steps.

These sections are validated and round-trip through descriptor serialization.
They also become explicit trampoline argv entries. The target loader now parses
and forwards them; the amd64 trampoline applies stack-window writes,
return-chain writes, stack guards, native private-memory mmap/copy/mprotect
steps, signal-mask save/apply/verify/restore steps, and executable-mapping
checks against the target code file/path/address/size/provenance before reporting
consumption. Active-syscall sections are still tracked for result reporting. The
target VM proof harness parses those native consumption events into
`targetStackWindowMaterializationResult`,
`targetPrivateMemoryRestoreResult`, `targetExecutableMappingResult`,
`targetSignalRestoreResult`, and `targetActiveSyscallRestoreResult`; any present
failed marker makes the verifier fail. Unsafe or malformed native section entries
fail closed before guest restore execution.
