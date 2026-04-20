# `@machinen/runtime` — TypeScript spawn API (v0.1)

Covers issue #49. Plain language, what was learnt while shipping the
first version.

## What the package does today

A thin wrapper around the Zig VMM binary. `spawn(opts)` returns a
handle with `stdin` / `stdout` / `stderr` streams, `wait()`, `kill()`,
and buffered `output()` / `errorOutput()` collectors.

v0.1 is intentionally small: no virtio, no snapshot-based spawn, no
multi-sandbox multiplexing. Those are issues #46, #50, #51.

## Decisions that pushed against the naive shape

### Buffered collectors run eagerly, not lazily

Early version let you call `vm.output()` when you wanted the string.
That loses data in two ways:

1. **Race against close.** If the child exits before the listener
   attaches, `on("data")` emits nothing and `on("end")` already
   fired — the Promise never resolves.
2. **Backpressure.** Our guest console goes to stderr (PL011 echo).
   During a Linux boot that's >200 KB in a few seconds. macOS pipe
   buffers are 64 KB. If nothing's draining, the child blocks on
   `write(2, ...)` and the boot stalls.

Fix: attach listeners immediately in `spawn()`, return the same
Promise on every `output()` call. Listens on both `"end"` and
`"close"` so the Promise resolves even when the child is killed.

### `timeoutMs` applies to `wait()`, not to the child

The natural API is "this VM should run for at most N seconds." But
that's a host-side policy, not a guest-side one — the VMM has its
own exit conditions. Implementing a max-duration cancel by passing
`timeoutMs` to `spawn` itself would let the handle go stale while
the process is still alive.

So `timeoutMs` just bounds how long `wait()` is willing to wait
before rejecting with `SpawnError`. If you want to cap runtime, do
`setTimeout(() => vm.kill(), n)` from the caller — explicit and
cancelable. `timeoutMs: null` means "wait forever."

### Binary discovery is the caller's problem

The Zig VMM binary lives in zig's cache under `.zig-cache/o/<hash>/test`
and the hash changes per build. v0.1 doesn't try to find it for you;
the caller passes the path. The microvm package's `smoke.sh` and the
runtime package's integration test both do the same "scan
`.zig-cache/o/*/test`, pick the one with the `MACHINEN_BOOT_TEST`
sentinel baked into its strings." That logic can move into the
runtime package once we have a story for distributing the binary
(probably a prebuilt tarball per arch).

## What v0.1 does NOT prove

- The runtime doesn't drive a specific guest workload. The
  integration test just asserts the kernel boots — "Linux version"
  and "Freeing unused kernel memory" show up on stderr. Driving
  Node/REPL/CRIU end-to-end is currently the microvm package's job
  via `test-fixtures/smoke.sh`. When #48 (CC in rootfs) and #50
  (snapshot spawn) land, driving specific workloads becomes
  runtime's job too.
- Stdio multiplexing across multiple concurrent VMs is #51. Today
  one VM per handle, one handle per terminal.

## Tests (2 unit, 1 integration)

- `throws SpawnError when the binary path does not exist` — purely
  local, no VM.
- `rejects wait() when the VMM exceeds its timeout` — uses the
  host's `yes` command as a stand-in long-running child. Verifies
  the timeout path without needing HVF or fixtures.
- `boots the VMM and the kernel reaches userspace` — integration.
  Skips (not fails) if the cached VMM binary or the microVM
  fixtures (Image / virt.dtb / initramfs.cpio) aren't present.
  Asserts kernel banner lines appear on stderr.

Run with `pnpm vitest run packages/runtime` or `pnpm test`.
