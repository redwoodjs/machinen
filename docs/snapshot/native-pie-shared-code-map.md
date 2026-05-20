# Native PIE/shared-library code map

Issue #480 extends native code-location mapping beyond fixed-address proof
binaries. Real Linux utilities are usually PIE executables with dynamically
loaded shared objects, so a captured program counter cannot be reused as a raw
virtual address on the target ISA.

## Command

```sh
pnpm native-pie-shared-code-map
```

The proof builds an unmodified PIE executable plus a sibling shared object. The
executable enters an exported function in the shared object and spins. The
external ptrace/procfs capturer stops the process, reads the captured PC, and
finds the executable mapping that contains it.

## Contract

For PIE and shared-library code, a mapped location is identified by:

- module identity (`logicalName`, path, build/build-id surrogate, arch);
- the runtime module load bias derived from `/proc/<pid>/maps`;
- the symbol's module-relative address from ELF symbol metadata;
- the captured offset inside that symbol.

The target address is computed as:

```text
target module load bias + target symbol relative address + captured offset in symbol
```

This proves the code map is ASLR-independent: the target address changes when
the target load bias changes, and the source virtual address is never reused as
the target-native address.

## Refusals

- `target-build-mismatch` when a target module's build identity does not match
  the expected target symbol/module identity.
- `code-location-unknown` when the source module, target module, symbol-relative
  address, or in-symbol offset cannot be proven.

## Boundary

This proof maps code locations only. It does not materialize target mappings,
unwind real stacks, classify heap pointers, or replay non-file resources. Those
follow in #481–#485.
