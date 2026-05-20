# Native stack translation

Issue #447 translates stack continuations for the native cross-ISA path.

## Command

```sh
pnpm native-stack-translate
```

The proof translates a metadata-proven frame, its return address, and a pointer
slot. It also has tests for missing unwind metadata, unknown return addresses,
and ambiguous pointer-like slots.

## Contract

A frame can translate only when:

- DWARF or sidecar unwind metadata identifies the frame boundary;
- the frame's source return address has a mapped target code location from #446;
- pointer or code-pointer slots have proven target values;
- integer slots are copied as bytes and are not relocated.

The translator emits `NativeMemoryRelocation` entries for return addresses and
proven pointer slots. It does not blindly copy raw source stack bytes as target
continuation state.

## Refusals

- `mapping-ambiguous` when a frame has no metadata;
- `code-location-unknown` when a return address or code pointer has no target;
- `pointer-ambiguous` when metadata cannot prove whether a slot is a pointer or
  integer.

Signal frames remain outside the stack translator; #445 refuses active signal
frames before stack translation starts.
