# Target guest private memory restore

Issue #657 consumes target guest memory materialization entries and produces the
steps the target VM loader must perform for private writable memory.

`planTargetGuestPrivateMemoryRestore()` emits:

- `mmap-private-writable` for the target private range;
- `copy-captured-bytes` from `native-memory.bin` into that range;
- `mprotect-final` for the final private permissions;
- `mmap-guard` for recreated no-access guard ranges.

## Accepted private-data class

Private memory restore is limited to captured target-owned data ranges: heap,
brk/data, and anonymous mmap ranges that are writable, non-executable, private,
have an explicit target address, and are fully covered by `native-memory.bin`.
The loader maps each accepted range writable, copies the captured bytes, then
applies the final non-executable permissions. This models data bytes only; source
text is never reused as target code.

Guard pages are recreated as no-access private mappings (`---p`) adjacent to the
accepted private range. They do not carry captured bytes and keep stack/heap/mmap
fault boundaries visible to the target process.

## Fail-closed mapping boundary

| Mapping state                                               | Result                               |
| ----------------------------------------------------------- | ------------------------------------ |
| executable or writable+executable                           | `mapping-executable-unsupported`     |
| shared writable/shared file-backed without coherence recipe | `mapping-shared-unsupported`         |
| missing target address or overlapping target ranges         | `mapping-ambiguous`                  |
| captured bytes missing or not from `native-memory.bin`      | `mapping-provenance-ambiguous`       |
| partial/out-of-range captured bytes                         | `mapping-captured-range-unsupported` |
| copied range is not writable/private data                   | `mapping-permission-unsupported`     |
| guard range is not exactly `---p`                           | `mapping-permission-unsupported`     |

The target amd64 trampoline now executes these native private memory steps
directly; when they are present, the portable VM proof does not also emit
duplicate legacy `memory=` mappings for the same ranges. Target TLS/TCB restore
now treats writable native private-memory ranges as valid backing for the TCB
handoff. This keeps private heap/data/mmap restoration separate from source
executable bytes and shared-resource state.
