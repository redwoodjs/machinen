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
- private anonymous data, heap, and writable mmap pages are copied from
  `native-memory.bin` when captured ranges exactly cover the mapping;
- stack, kernel-style, and no-access guard mappings are recreated without
  copied source bytes;
- an unsafe unreadable mapping remains refused with `mapping-unreadable`;
- final permissions are checked through `/proc/self/maps`.

## Runtime planner

`planNativeMappingMaterialization()` converts `NativeMemoryMapping` entries into
loader steps:

- `map-target-file` for executable target-file mappings with build-id or hash
  provenance;
- `copy-captured-bytes` for safe private anonymous/data/heap/writable mmap
  mappings;
- `recreate` for target-owned stack/kernel mappings and safe guard mappings;
- `omit` for source-only mappings intentionally dropped;
- `refuse` for fail-closed mappings.

## Refusals

- `mapping-unreadable` is preserved from capture for unsafe unreadable mappings
  and includes mapping details when the planner reports it.
- `mapping-ambiguous` is used for missing target addresses, non-adjacent private
  writable guards, or recreated mappings that still carry source bytes.
- `mapping-captured-range-unsupported` rejects private writable mappings with
  missing or invalid captured bytes.
- `mapping-executable-unsupported` rejects executable mappings that lack a
  target-native file, so captured source text is never copied as target code.
- `mapping-provenance-ambiguous` rejects executable target files without build-id
  or hash provenance.
- `mapping-permission-unsupported` rejects writable+executable mappings.
- `mapping-shared-unsupported` rejects shared writable memory.
- `target-build-mismatch` rejects file-backed target mappings whose expected
  target build identity does not match.

## Boundary

Private writable mappings remain target-private: shared writable memory is not
copied, and optional `privateWritableGuards` must point at recreated no-access
mappings directly adjacent to the protected target range.

This proof materializes mappings and validates bytes/permissions. It does not
unwind real stacks, discover pointer fields, replay non-file resources, or claim
arbitrary utility resume.
