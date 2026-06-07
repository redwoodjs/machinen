# Target guest memory materialization

Issue #588 adds the first target-guest memory materialization pass for portable
machine snapshots.

The pass consumes native process image mappings plus `native-memory.bin` and
emits descriptor entries for only two safe cases:

1. `copy-captured-bytes` — non-executable writable mappings with complete
   captured byte coverage and an explicit target address.
2. `recreate-guard` — private guard / `PROT_NONE` mappings that carry no source
   bytes.

Executable source mappings are refused with `mapping-executable-unsupported`
unless a separate target-module materialization proof supplies target-native
bytes. This keeps source text from becoming target code. Source vDSO, vvar, and
special mapping bytes are also refused with `vdso-policy-unsupported`; the target
kernel owns those mappings and they must be recreated or verified on the target,
not copied from the source. Shared mappings are refused with
`mapping-shared-unsupported` until an explicit shared-resource recipe exists.
Captured bytes must come from `native-memory.bin`; ambiguous provenance returns
`mapping-provenance-ambiguous`, and partial/out-of-range captures return
`mapping-captured-range-unsupported`.

The target guest loader forwards memory descriptor entries to the native resume
trampoline, and the trampoline maps those ranges before the target continuation
jump. Overlapping target ranges still fail closed with `mapping-ambiguous`.
