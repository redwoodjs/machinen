# Native DWARF pointer classification proof

Issue #483 removes the proof-side hardcoding for native heap/global pointer fields. The source process is still an ordinary Linux C process, but pointer relocation is driven by DWARF type metadata instead of JavaScript-known field offsets.

## Flow

1. Build an arm64 source binary with `-g`.
2. Capture it with the native ptrace/procfs process-image capturer.
3. Read DWARF `.debug_info` from the source binary.
4. Locate these struct layouts:
   - `struct NativeDebugPointerRoot`
   - `struct NativeDebugPointerNode`
5. Classify each captured 8-byte field by debug type:
   - `DW_TAG_pointer_type` fields become relocatable data pointers.
   - integer/base-type fields are preserved as scalar bytes, even when their value looks like an address.
6. Map data pointers through known source-to-target mapping translations.
7. Refuse uncertainty with exact codes:
   - `pointer-ambiguous` for missing or unknown field metadata.
   - `mapping-ambiguous` when a data pointer cannot be mapped to exactly one target mapping.
   - `code-location-unknown` when a code pointer lacks a target code location.
8. Resume on amd64 and return through the translated native frame. The target code walks the relocated graph and verifies that scalar lookalikes were **not** relocated.

## What this proves

The fixture has a global root and two heap records. The root and first node contain real pointer fields and scalar lookalikes containing the same source addresses:

- `root.head` is a pointer and must relocate to the target heap.
- `root.scalar_lookalike` is an integer and must remain the original source value.
- `node.next` is a pointer and must relocate to the next target node.
- `node.scalar_lookalike` is an integer and must remain unchanged.

The amd64 continuation fails if those scalar lookalikes equal the relocated target pointers, so the final jump only succeeds when metadata classification is honored.

## Limits

This is a controlled `-O0 -g` C proof. It does not infer arbitrary C/C++ heap ownership, GC-managed heaps, optimized-away locals, or stripped binaries without external debug metadata. Interior pointers, overlapping target mapping matches, and unknown field types remain refusal cases.

## Verify

Run on Linux:

```sh
pnpm native-dwarf-pointer-classification
```

On non-Linux hosts the verifier skips because capture depends on Linux ptrace/procfs and `readelf`.
