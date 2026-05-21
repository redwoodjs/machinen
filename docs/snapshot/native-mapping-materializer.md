# Native mapping materializer

Issue #481 applies a native process-image mapping plan instead of only checking
mapping policy metadata.

## Command

```sh
pnpm native-mapping-materializer
```

The proof builds a small target mapping plan and runs a Linux helper that
materializes it with `mmap`:

- file-backed executable text comes from a target artifact;
- anonymous data and heap pages are copied from `native-memory.bin`;
- stack, kernel-style, and no-access guard mappings are recreated without
  copied source bytes;
- an unsafe unreadable mapping remains refused with `mapping-unreadable`;
- final permissions are checked through `/proc/self/maps`.

## Runtime planner

`planNativeMappingMaterialization()` converts `NativeMemoryMapping` entries into
loader steps:

- `map-target-file` for executable target-file mappings;
- `copy-captured-bytes` for safe anonymous/data/heap mappings;
- `recreate` for target-owned stack/kernel mappings and safe guard mappings;
- `omit` for source-only mappings intentionally dropped;
- `refuse` for fail-closed mappings.

## Refusals

- `mapping-unreadable` is preserved from capture for unsafe unreadable mappings
  and includes mapping details when the planner reports it.
- `mapping-ambiguous` is used for missing target addresses, missing captured
  bytes, invalid byte ranges, or recreated mappings that still carry source
  bytes.
- `mapping-permission-unsupported` rejects writable+executable mappings.
- `target-build-mismatch` rejects file-backed target mappings whose expected
  target build identity does not match.

## Boundary

This proof materializes mappings and validates bytes/permissions. It does not
unwind real stacks, discover pointer fields, replay non-file resources, or claim
arbitrary utility resume.
