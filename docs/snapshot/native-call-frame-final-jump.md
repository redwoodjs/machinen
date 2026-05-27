# Native captured call-frame final-jump proof

This proof shows a target-native return through a translated call frame. The
source process is captured on arm64 while it is inside an active function. The
amd64 restore path maps matching target-binary code for both the active function
and its return landing function, seeds the translated return address on the
target stack, jumps into the active function, and lets native `ret` transfer
control to the translated landing function.

## Command

On an arm64 Linux source host:

```sh
pnpm native-call-frame-final-jump --out-dir /tmp/native-call-frame-source --json
```

That captures an unmodified source process with `ptrace` and writes
`/tmp/native-call-frame-source/source-bundle`.

On an amd64 Linux target host:

```sh
MACHINEN_NATIVE_CALL_FRAME_SOURCE_BUNDLE=/path/to/source-bundle \
  pnpm native-call-frame-final-jump --out-dir /tmp/native-call-frame-target --json
```

The default command skips on amd64 when no source bundle is supplied, because the
proof must start from a real arm64 Linux capture.

## What it proves

The source and target program is
`packages/microvm/test-fixtures/proof-assets/native-call-frame-continuation.c`.

The arm64 source build is captured while:

- the PC is inside `machinen_native_call_frame_active`;
- `x0` points at page-aligned process state;
- `x30` carries the source return address for
  `machinen_native_call_frame_return`.

The amd64 target run compiles the same C source, extracts the real
`machinen_native_call_frame_active` and `machinen_native_call_frame_return`
functions from the binary's `.machinen_resume` section, and records the target
binary SHA-256 as the build id. Stack translation maps the captured source return
address to the amd64 return landing address. The trampoline then writes that
translated address into the target stack slot and jumps, not calls, into the
active amd64 function.

A passing run proves:

1. native amd64 target-binary active code executed;
2. the active code observed the target stack;
3. native `ret` consumed the translated stack slot;
4. the matching amd64 return landing function executed.

The successful execution marker is:

```text
captured-arm64-source-returned-through-matching-amd64-target-binary-frame
```

## Boundary

This is still a controlled frame. It uses sidecar metadata for the active PC,
the return address, the pointer-bearing register, and the pointer-bearing data
word. The [Native DWARF unwind frame discovery](./native-dwarf-unwind-frames.md)
proof removes the proof-known return slot for one controlled frame by reading
real CFI. The heap-graph final-jump proof builds on this by translating multiple
pointer-bearing root/heap words and making the return landing walk that graph
natively. The file-resource final-jump proof also builds on this path by
reopening a captured regular-file fd before target-native code reads from it
after the return. These proofs do not claim general unwind recovery, optimized
frame handling, dynamic loader relocation, active syscall restore, signal-frame
restore, TLS reconstruction, or brokered socket/PTY support.
