# Target guest private memory restore

Issue #657 consumes target guest memory materialization entries and produces the
steps the target VM loader must perform for private writable memory.

`planTargetGuestPrivateMemoryRestore()` emits:

- `mmap-private-writable` for the target private range;
- `copy-captured-bytes` from `native-memory.bin` into that range;
- `mprotect-final` for the final private permissions;
- `mmap-guard` for recreated no-access guard ranges.

Executable entries and shared entries fail closed with
`mapping-executable-unsupported` and `mapping-shared-unsupported`. Guard entries
must be `---p`. This keeps private heap/data/mmap restoration separate from
source executable bytes and shared-resource state.
