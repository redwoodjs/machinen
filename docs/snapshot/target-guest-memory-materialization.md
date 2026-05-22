# Target guest memory materialization

Issue #588 adds the first target-guest memory materialization pass for portable
machine snapshots.

The pass consumes native process image mappings plus `native-memory.bin` and
emits descriptor entries for only two safe cases:

1. `copy-captured-bytes` — non-executable writable mappings with complete
   captured byte coverage and an explicit target address.
2. `recreate-guard` — private guard / `PROT_NONE` mappings that carry no source
   bytes.

Executable source mappings are refused with `target-module-bytes-missing` unless
a separate target-module materialization proof supplies target-native bytes. This
keeps source text from becoming target code.

The target guest loader forwards memory descriptor entries to the native resume
trampoline, and the trampoline maps those ranges before the target continuation
jump. Overlapping target ranges and captured-byte underlaps fail closed with
`mapping-ambiguous`.
