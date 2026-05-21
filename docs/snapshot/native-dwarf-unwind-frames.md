# Native DWARF unwind frame discovery

Issue #482 replaces the proof-known call-frame slot with a frame discovered from
real DWARF/eh-frame unwind metadata.

## Command

On an arm64 Linux source host:

```sh
pnpm native-dwarf-unwind-frames --out-dir /tmp/native-dwarf-source --json
```

That captures an unmodified source process and writes
`/tmp/native-dwarf-source/source-bundle/native-unwind-frames.json` beside the
native process-image bundle.

On an amd64 Linux target host:

```sh
MACHINEN_NATIVE_DWARF_UNWIND_SOURCE_BUNDLE=/path/to/source-bundle \
  pnpm native-dwarf-unwind-frames --out-dir /tmp/native-dwarf-target --json
```

## What it proves

The source/target program is
`packages/microvm/assets/native-dwarf-unwind-continuation.c`.

The arm64 source function publishes CFI for its active frame:

- CFA is based on `x29`;
- saved `x30` is described relative to CFA;
- the process is stopped while PC is inside that FDE;
- the proof computes the return-address slot from the FDE and reads the saved
  return address from captured stack bytes.

The discovered frame is then fed into `translateNativeStack()` as DWARF-derived
metadata. On amd64, the target proof maps matching active/return functions from
the target binary and lets native `ret` consume the translated return slot.

A passing target run emits:

```text
captured-arm64-source-returned-through-dwarf-discovered-amd64-frame
```

## Refusals

- `thread-state-unsupported` when no unwind rule covers the captured PC.
- `pointer-ambiguous` when the CFI return-address slot was not captured.
- `architecture-unsupported` for source architectures not modeled by this proof.
- `code-location-unknown` remains the stack translator's refusal when a
  discovered return PC cannot be mapped to target code.

## Boundary

This is still a controlled frame shape. It proves unwind-derived frame discovery
for the active arm64 frame and target-native `ret` through the translated return
address. It does not yet claim support for optimized frameless functions,
signal frames, syscall restart frames, dynamic-loader unwinding, or arbitrary
mixed-language stacks.

Next: [Native DWARF pointer classification proof](./native-dwarf-pointer-classification.md).
