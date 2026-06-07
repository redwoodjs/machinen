# DWARF metadata extraction proof

Issue #418 replaces the known-symbol proof's hardcoded C offsets with DWARF/debug metadata.

The source process is still an ordinary controlled C binary. It does not call `machinen_checkpoint`. The verifier reads DWARF from the debug build, finds exported globals, decodes struct members by name, detects pointer-typed fields, and then uses those offsets to capture and translate semantic state.

## Flow

1. Build the controlled corpus with `-g -O0 -fno-pie -no-pie`.
2. Read DWARF `.debug_info` with `readelf --debug-dump=info`.
3. Locate these global variables from DWARF, including their `DW_OP_addr` locations:
   - `machinen_controlled_dwarf_global_state`
   - `machinen_controlled_dwarf_heap_state`
4. Read these struct layouts from DWARF instead of from JavaScript constants:
   - `struct ControlledDwarfGlobalState`
   - `struct ControlledDwarfHeapState`
   - `struct ControlledDwarfNode`
5. Detect pointer fields such as `ControlledDwarfHeapState.head` and `ControlledDwarfNode.next`.
6. Pass the DWARF-derived list layout to the raw capturer.
7. Capture global bytes and heap nodes from `/proc/<pid>/mem`.
8. Decode fields by name and emit a portable bundle plus `dwarf-layout.json`.
9. Restore the semantic global and heap state into a matching target binary.

The DWARF fixture deliberately uses a layout that differs from the earlier known-symbol heap fixture. The extractor still recovers the state because it asks DWARF for field offsets and pointer fields.

## Cross-architecture mapping

The bundle records a field-name mapping from source layout to target layout:

- source field name
- source offset
- target offset
- source type
- target type
- pointer/non-pointer classification

For the same build on another architecture, the semantic values are moved by field name rather than by raw offset. The current proof uses the controlled restore sidecar for the final replay step, but the portable bundle documents and `dwarf-layout.json` contain the information needed to rewrite pointers and fields for a target layout.

## Stack/local-variable probe

The verifier also inspects DWARF for `controlled_nested_stack_point` and reports visible formal parameters and locals, including `live_local` on unoptimized builds. This is exploratory only. Stack continuation translation is handled in the next issue because local-variable DWARF is less stable than global/heap metadata.

## Limits

DWARF is enough for this controlled `-O0` proof, but real optimized binaries need more care:

- Optimized locals may live only in registers or may be optimized away.
- Inlined functions can split one source frame across several machine frames.
- Location lists can be PC-range dependent.
- Tail calls can erase frames that existed in the source language.
- Stripped binaries need an external debug file, build-id lookup, or a sidecar format.
- Raw stack bytes are still architecture-specific; DWARF only tells us how to interpret values that are recoverable at a safe point.

## Verify

Run on Linux:

```sh
pnpm dwarf-symbol-extract
```

On non-Linux hosts the verifier skips, because capture depends on Linux `/proc`, `ptrace`, and `readelf`.
