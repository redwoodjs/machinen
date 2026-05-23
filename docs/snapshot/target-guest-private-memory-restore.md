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
must be `---p`. The target amd64 trampoline now executes these native private
memory steps directly; when they are present, the portable VM proof does not also
emit duplicate legacy `memory=` mappings for the same ranges. Target TLS/TCB
restore now treats writable native private-memory ranges as valid backing for the
TCB handoff. This keeps private heap/data/mmap restoration separate from source
executable bytes and shared-resource state.
