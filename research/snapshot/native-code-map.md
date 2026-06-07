# Native code-location mapping

Issue #446 maps source-ISA code locations to target-native code locations before
register, stack, or memory pointer translation can use them.

## Command

```sh
pnpm native-code-map
```

The baseline proof maps a controlled `native_controlled_resume` symbol and
separately refuses a target build mismatch. The follow-up
[Native PIE/shared-library code map](./native-pie-shared-code-map.md) proof adds
module-relative mapping for ASLR, PIE executables, and shared objects.

## Contract

A code map requires:

- target build identity matching the expected build id;
- a source symbol for the captured address;
- a target symbol with the same logical name;
- for PIE/shared-library code, source and target module identity plus load bias
  and module-relative symbol addresses;
- DWARF or sidecar size metadata when bare symbols are not enough to prove the
  location boundary.

Mapped locations become `NativeCodeLocationMapping` entries with source mapping,
source address, and target address. For module-relative locations, the target
address is `target load bias + target symbol RVA + offset within symbol`, not the
captured source virtual address. Unknown or ambiguous locations are emitted as
`code-location-unknown` refusals.

## Refusals

- `target-build-mismatch` stops the whole map before translating addresses.
- `code-location-unknown` is used when a source symbol, target symbol, or
  required metadata is missing.

## Boundary

This issue only decides where source code addresses land in the target. It does
not translate stack frames (#447), pointer-bearing memory (#448), or install
registers (#445).
