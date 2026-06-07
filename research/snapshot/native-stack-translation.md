# Native stack translation

Issue #447 translates stack continuations for the native cross-ISA path.

## Command

```sh
pnpm native-stack-translate
```

The proof translates a metadata-proven frame, its return address, and a pointer
slot. It also materializes a bounded target stack window with source/target
bounds, guard-page placement, frame-size checks, per-slot offset checks, and
pointer-range validation. Tests cover missing unwind metadata, unknown return
addresses, ambiguous pointer-like slots, malformed windows, bad guards, and
out-of-range pointers.

## Contract

A frame can translate only when:

- DWARF or sidecar unwind metadata identifies the frame boundary;
- the frame's source return address has a mapped target code location from #446;
- pointer or code-pointer slots have proven target values;
- pointer slots land inside the target stack window or an explicitly
  materialized target pointer range;
- integer slots are copied as bytes and are not relocated;
- translated frames fit inside the target stack window and the guard pages
  bracket that window.

The translator emits `NativeMemoryRelocation` entries for return addresses and
proven pointer slots. `planNativeStackWindowMaterialization()` wraps those
relocations in a fail-closed target-window plan before restore code may consume
them. It does not blindly copy raw source stack bytes as target continuation
state.

## Refusals

- `mapping-ambiguous` when a frame has no metadata;
- `code-location-unknown` when a return address or code pointer has no target;
- `pointer-ambiguous` when metadata cannot prove whether a slot is a pointer or
  integer, or when a proven pointer targets no materialized target range;
- `target-stack-window-unsupported` when source/target stack bounds, frame sizes,
  per-slot offsets, or guard placement are unsafe.

Signal frames remain outside the stack translator; #445 refuses active signal
frames before stack translation starts.
