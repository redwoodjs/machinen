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
They also become explicit trampoline argv entries so the target loader can
materialize them and report consumption. Unsafe or malformed native section
entries fail closed before guest restore execution.
