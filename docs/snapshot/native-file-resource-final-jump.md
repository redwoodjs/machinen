# Native captured file-resource final-jump proof

This proof carries a captured regular-file descriptor through the native
call-frame resume path. The source process is captured on arm64 with a normal
file open at a known offset. The amd64 target trampoline reopens that file from
the translated resource recipe before jumping, then the target-native return
landing reads from the fd after native `ret`.

## Command

On an arm64 Linux source host:

```sh
pnpm native-file-resource-final-jump --out-dir /tmp/native-file-resource-source --json
```

That captures an unmodified source process with `ptrace` and writes
`/tmp/native-file-resource-source/source-bundle`. The proof file payload is
stored inside that bundle as `native-file-resource.txt` so it can move with the
bundle to the amd64 host.

On an amd64 Linux target host:

```sh
MACHINEN_NATIVE_FILE_RESOURCE_SOURCE_BUNDLE=/path/to/source-bundle \
  pnpm native-file-resource-final-jump --out-dir /tmp/native-file-resource-target --json
```

The default command skips on amd64 when no source bundle is supplied, because the
proof must start from a real arm64 Linux capture.

## What it proves

The source and target program is
`packages/microvm/test-fixtures/proof-assets/native-file-resource-continuation.c`.

The arm64 source build opens `native-file-resource.txt`, seeks to offset `9`, and
stores the fd in page-aligned process state while:

- the PC is inside `machinen_native_file_resource_active`;
- `x0` points at the state page;
- `x30` carries the source return address;
- native resources record the regular-file fd, path, flags, and offset.

The amd64 target run compiles the same C source, extracts matching active and
return functions from `.machinen_resume`, translates the call frame and data
pointer, rewrites the file recipe to the bundle-local payload path, and asks the
trampoline to reopen the fd before the final jump. The return landing uses an
amd64 Linux `read` syscall on that fd and verifies that the byte at the captured
offset is `0x4d`.

The successful execution marker is:

```text
captured-arm64-file-resource-reopened-after-native-amd64-ret
```

## Boundary

This proof covers only regular files with a path that can be reopened on the
target host. It does not claim pipes, sockets, PTYs, epoll sets, futexes, timers,
credentials, namespaces, or brokered resources. Those must still use precise
resource refusal codes until a host broker exists.
