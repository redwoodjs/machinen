# Native captured heap-graph final-jump proof

This proof carries a small pointer graph through the native call-frame resume
path. The source process is captured on arm64 with a global/root object pointing
to two heap nodes. The amd64 target code walks the translated graph only after
native `ret` lands in the translated return function.

## Command

On an arm64 Linux source host:

```sh
pnpm native-heap-graph-final-jump --out-dir /tmp/native-heap-graph-source --json
```

That captures an unmodified source process with `ptrace` and writes
`/tmp/native-heap-graph-source/source-bundle`.

On an amd64 Linux target host:

```sh
MACHINEN_NATIVE_HEAP_GRAPH_SOURCE_BUNDLE=/path/to/source-bundle \
  pnpm native-heap-graph-final-jump --out-dir /tmp/native-heap-graph-target --json
```

The default command skips on amd64 when no source bundle is supplied, because the
proof must start from a real arm64 Linux capture.

## What it proves

The source and target program is
`packages/microvm/assets/native-heap-graph-continuation.c`.

The arm64 source build creates this graph in ordinary process memory:

```text
global/root page -> heap node A -> heap node B
```

The capture records:

- the active PC;
- the source return address;
- `x0`, which points at the root page;
- the root-to-node pointer;
- the node-A-to-node-B pointer;
- the node values whose checksum is `0x4d`.

The amd64 target run compiles the same C source, extracts matching active and
return functions from `.machinen_resume`, translates all pointer-bearing graph
edges, materializes target root/heap pages, seeds the translated return address
on the target stack, and jumps into native amd64 code. The return landing walks
the translated graph natively and reports the checksum.

The successful execution marker is:

```text
captured-arm64-heap-graph-walked-after-native-amd64-ret
```

## Boundary

This is still a controlled graph with sidecar classification for each
pointer-bearing word. It does not claim arbitrary heap discovery, conservative
pointer scanning, garbage-collected runtime support, dynamic loader relocation,
TLS reconstruction, active syscall restore, signal-frame restore, or resource
broker support. Missing graph classification must remain a precise refusal.
