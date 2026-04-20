# Multiplex M1.5 — PTY layer for the Supervisor

Issue: redwoodjs/machinen#51. M1 shipped with pipe-backed VmHandles
and a text-only Supervisor. M1.5 adds a pty-backed path and makes the
Supervisor terminal-aware (raw mode, SIGWINCH) so attached sandboxes
feel like a real shell instead of a pipe.

## What's different from M1

* **`spawnPty(opts)`** alongside `spawn(opts)`. Same handle shape with
  one addition: `resize(cols, rows)`. Under the hood this is `node-pty`
  because writing our own `openpty`/`forkpty` C shim isn't where the
  ROI lives — production-tested prebuilts for darwin-arm64 + linux
  exist.
* **Raw-mode stdin on attach** — default-on when `process.stdin` is a
  real TTY. Restored to the prior mode on detach. Tests pass
  `rawTtyOnAttach: false` so `PassThrough` streams don't pretend to
  be terminals.
* **SIGWINCH forwarding** — default-on when `process.stdout` is a
  TTY. On attach, the Supervisor immediately calls the sandbox's
  `resize(cols, rows)` with the current host terminal size; on every
  subsequent SIGWINCH the handler re-pushes. Unhooked on detach.
* **`Sandboxes` stays unchanged.** It accepts anything that looks
  like a `VmHandle`; the `resize` method is an optional extra the
  Supervisor uses when present.

## The `node-pty` gotchas

1. **`spawn-helper` gets the exec bit stripped during pnpm install.**
   On macOS node-pty uses a small helper binary it posix_spawnp's
   into; pnpm sometimes unpacks the prebuild without +x and the next
   `pty.spawn()` fails with a cryptic `posix_spawnp failed.`. The
   runtime's `ensureSpawnHelper()` walks `prebuilds/` the first time
   a pty is requested and chmods 0o755 on any helper missing the
   bit. One-shot no-op on healthy installs.
2. **Allow the postinstall.** `node-pty` needs to be in pnpm's
   `onlyBuiltDependencies` (in `pnpm-workspace.yaml`) for its rebuild
   step to run, otherwise the binding isn't resolved against the
   right Node version on install.
3. **Paused PassThrough drains to the first `data` listener.** The
   pty wrapper collects output in the `onData` callback (not via a
   PassThrough listener) because a listener would drain the buffer
   before the real consumer subscribes.

## What this doesn't do (yet)

* **Guest-side TIOCSWINSZ.** The pty is host-side; the guest sees
  `ttyAMA0`, not a pty. For the guest to know the terminal size we
  need a vsock side-channel: supervisor → guest agent → `ioctl(fd,
  TIOCSWINSZ)`. Easy once a guest agent exists (and vsock shipped in
  #44 M2+).
* **Colors inside the VMM binary.** The VMM just pushes PL011 bytes
  through; it doesn't care about its own stdio. What it does is
  already byte-transparent, so colors emitted by CC in the guest
  reach the host terminal intact.
* **Scrollback-across-detach.** M1 kept an 8 KiB per-sandbox ring;
  M1.5 didn't touch that. Longer scrollback is a Sandboxes option
  change, not a Supervisor change.

## Tests

`packages/runtime/src/__tests__/pty.test.ts`:

- `tty` prints a pty device path inside the child (macOS ttys /
  Linux pts both match).
- `stty size` reflects the requested rows/cols, and a later
  `resize()` reshapes the pty live.
- `spawnPty`-backed handles plug into `Sandboxes.add` and the
  registered scrollback picks up pty output.
- Supervisor SIGWINCH handler actually calls the attached sandbox's
  `resize(cols, rows)`.

4 test files, 21 tests, all passing.

## Repro

```
pnpm --filter @machinen/runtime exec tsx src/bin/supervise.ts 3
# /ls
# /attach 0
# ls --color=auto   (colors flow through)
# resize the terminal window — SIGWINCH propagates
# Ctrl-] Ctrl-]     (detach)
```
