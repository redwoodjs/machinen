# Native captured-process final-jump proof

This proof bridges external process capture to the target-native final jump.

## Command

On an arm64 Linux source host:

```sh
pnpm native-captured-final-jump --out-dir /tmp/native-captured-source --json
```

That captures an unmodified source process with `ptrace` and writes
`/tmp/native-captured-source/source-bundle`.

On an amd64 Linux target host:

```sh
MACHINEN_NATIVE_CAPTURED_FINAL_JUMP_SOURCE_BUNDLE=/path/to/source-bundle \
  pnpm native-captured-final-jump --out-dir /tmp/native-captured-target --json
```

The default command skips on amd64 when no source bundle is supplied, because the
proof must start from a real arm64 Linux capture.

## What it proves

The source program in `packages/microvm/test-fixtures/proof-assets/native-final-jump-source.c` is not
linked to Machinen and does not write a bundle. It only spins in user space with
normal native state:

- the captured arm64 PC is inside a named spin function;
- arm64 `x0` points at a page-aligned data page;
- the first word of that captured data page is a self pointer.

The target-side proof then:

1. validates the real captured arm64 bundle;
2. maps the captured PC to an amd64 continuation by sidecar metadata;
3. relocates the captured `x0` pointer to target amd64 `rdi`;
4. records a memory relocation for the captured self pointer;
5. maps translated amd64 text/data and a target stack;
6. jumps into native amd64 code and verifies the code used the relocated pointer
   and target stack.

The successful execution marker is:

```text
captured-arm64-source-jumped-target-native-amd64-code
```

## Boundary

This is still a controlled source process. It proves that the final-jump path can
start from a real external capture, but the target continuation is still a tiny
in-bundle amd64 proof function. The target-binary final-jump proof replaces that
with compiled bytes from the matching amd64 target binary. Both proofs depend on
sidecar facts for the source PC, the register pointer, the stack frame, and the
pointer-bearing data word. Missing facts still must refuse with the existing
ambiguity/resource codes.
