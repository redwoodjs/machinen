# Native captured target-binary final-jump proof

This proof removes the synthetic amd64 proof blob from the captured-process
final jump. The source state still comes from a real arm64 Linux process, and
the target continuation bytes now come from the matching amd64 build of the
controlled native program.

## Command

On an arm64 Linux source host:

```sh
pnpm native-target-binary-final-jump --out-dir /tmp/native-target-binary-source --json
```

That captures an unmodified source process with `ptrace` and writes
`/tmp/native-target-binary-source/source-bundle`.

On an amd64 Linux target host:

```sh
MACHINEN_NATIVE_TARGET_BINARY_SOURCE_BUNDLE=/path/to/source-bundle \
  pnpm native-target-binary-final-jump --out-dir /tmp/native-target-binary-target --json
```

The default command skips on amd64 when no source bundle is supplied, because the
proof must start from a real arm64 Linux capture.

## What it proves

The source and target program is
`packages/microvm/test-fixtures/proof-assets/native-target-binary-continuation.c`.

The arm64 build is launched as a normal process and captured externally. It does
not call Machinen and does not write a snapshot. At capture time:

- the captured arm64 PC is in the source safe-point loop;
- arm64 `x0` points at page-aligned process state;
- the first captured data word is a self pointer.

The amd64 target run compiles the same C source, extracts the real
`machinen_native_target_binary_resume` function from its `.machinen_resume`
section, records the target binary SHA-256 as the target build id, and maps those
compiled bytes as target text. The restore proof then translates the captured PC,
register pointer, stack frame, and data self pointer before jumping into that
amd64 target-binary function.

The successful execution marker is:

```text
captured-arm64-source-jumped-matching-amd64-target-binary
```

## Boundary

This is still a controlled binary with sidecar metadata for the safe point and
pointer-bearing slots. The call-frame final-jump proof builds on this by also
translating a source return address and letting native amd64 `ret` consume the
target stack slot. Neither proof claims arbitrary ELF relocation, dynamic loader
state, active syscalls, signal frames, TLS reconstruction, or resource broker
support. Missing target build identity or symbol metadata must remain a precise
refusal before this can become a general native process resume.
