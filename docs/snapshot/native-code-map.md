# Native code-location mapping

Issue #446 maps source-ISA code locations to target-native code locations before
register, stack, or memory pointer translation can use them.

## Command

```sh
pnpm native-code-map
```

The proof maps a controlled `native_controlled_resume` symbol and separately
refuses a target build mismatch.

## Contract

A code map requires:

- target build identity matching the expected build id;
- a source symbol for the captured address;
- a target symbol with the same logical name;
- DWARF or sidecar size metadata when bare symbols are not enough to prove the
  location boundary.

Mapped locations become `NativeCodeLocationMapping` entries with source mapping,
source address, and target address. Unknown or ambiguous locations are emitted as
`code-location-unknown` refusals.

## Refusals

- `target-build-mismatch` stops the whole map before translating addresses.
- `code-location-unknown` is used when a source symbol, target symbol, or
  required metadata is missing.

## Boundary

This issue only decides where source code addresses land in the target. It does
not translate stack frames (#447), pointer-bearing memory (#448), or install
registers (#445).
