# Native real utility code-location mapping

Issue #494 adds a target-code gate for real Linux utilities. The gate maps a
captured source program counter to target-native code by module identity plus a
module-relative virtual address (RVA). It never treats captured arm64 text bytes
or raw source virtual addresses as amd64 code.

## Rule

For each captured thread:

1. Refuse first if the thread is not `outside-syscall`. That keeps #492's
   active-syscall safety gate ahead of target-code work.
2. Find the executable source mapping that contains the captured PC.
3. Build source module identity from the mapping path, kind, source arch,
   build identity, load bias, and text mapping id.
4. Match an explicit target amd64 module inventory entry by expectation,
   target module id/path, or compatible logical name.
5. Compute `sourceRva = sourcePc - sourceModule.loadBias`.
6. Accept only if the target module is executable, has the expected target build
   id, and maps that RVA as executable target code.
7. Produce `targetAddress = targetModule.loadBias + sourceRva`.

The proof reports `sourceTextReusedAsTargetCode: false` and does not attempt a
resume. It only proves that the next native continuation address is selected
from target-native module metadata.

## Precise refusals

- `active-syscall` — thread-state safety wins before code mapping.
- `target-module-missing` — no explicit target module matches the source module.
- `target-module-not-executable` — the matched target module is not executable
  code.
- `target-build-id-mismatch` — the target module build id is not the expected
  target build.
- `target-code-location-unresolved` — the captured PC is not inside inventoried
  executable source code.
- `target-code-rva-unmapped` — the target module exists, but the source RVA is
  not executable in that module.

## Proof

`pnpm native-real-utility-code-map --json` captures a real arm64 shell spinning
in user space, inventories executable source mappings, supplies an explicit
amd64 target module inventory, maps the captured PC by RVA, and emits:

```text
real-arm64-utility-pc-mapped-to-amd64-module-rva
```

The target inventory is metadata only. A later proof owns materializing bytes
and actually jumping.
