# Stdio multiplexing across many sandboxes — design note + plan

Covers issue #51. Today one VM owns the host terminal — our PL011
stdin thread plumbs keystrokes straight through to the guest. Once
`@machinen/runtime` (#49) can run multiple VMs concurrently, we need
a way to address "talk to sandbox #3" without tearing down the current
model.

## Why the current shape doesn't scale

PL011 emulation is per-VM and there's exactly one host terminal. If
two VMs try to own stdin simultaneously, they fight. The `runtime`
package's `vm.stdin` / `vm.stdout` streams are fine for programmatic
use (pipe in, collect out), but for _interactive_ use you need a
supervisor that multiplexes one terminal across N sandboxes.

## Proposed architecture

Three pieces:

### 1. `@machinen/runtime` supervisor (host-side)

- Tracks all live VM handles (extends the v0.1 API surface: add a
  handle registry, each with a human-readable id).
- Exposes `machinen.list()`, `.attach(id)`, `.detach()`, `.send(id, s)`.
- `.attach(id)` switches the real terminal's stdin/stdout so bytes
  go to/from that specific VM. `.detach()` returns the terminal to
  the supervisor prompt.
- Keeps per-VM scrollback buffers so attaching to a VM shows its
  recent output, not a blank screen.

### 2. Per-VM pty pair (instead of raw pipes)

- For each VM, create a pty pair on the host.
- The guest's serial output goes to the master end; the supervisor
  reads from there.
- Input to the guest goes to the master end's write side.
- A pty (vs pipe) makes Node's REPL + CC's own terminal handling
  behave correctly — Node sees `isTTY: true`, enables colors,
  handles resize, etc.

### 3. vsock as the cleaner long-term channel

- PL011 serial is fine for v0.1. But vsock (virtio-vsock) is the
  "right" channel for host↔guest communication — it's a socket
  pair, not a serial port, so it avoids tty-emulation concerns and
  can carry structured messages.
- For CC specifically, interactive streams go over a pty (so CC's
  terminal UI works), but control-plane messages (list processes,
  spawn another sandbox from inside, fetch logs) go over vsock.
- vsock depends on the virtio-MMIO transport from #46. Not a
  blocker for M1 of this issue — PL011 works. But worth building
  in the direction that makes vsock easy to add later.

## Milestones

### M1 — supervisor + per-VM pty, PL011 unchanged inside the guest

- `@machinen/runtime` gains a registry + `.attach()` / `.detach()`.
- `spawn()` opens a pty pair by default (vs raw pipes). The VMM
  child's stdio is attached to the pty slave.
- A simple supervisor CLI: type `/attach 3` to attach to VM #3,
  `Ctrl-] Ctrl-]` to detach back to the supervisor prompt.
- Works with today's PL011 — the VMM is unchanged.

Test: spawn three mock long-running processes via the runtime
package (use `/bin/cat` or equivalent, not full VMs, to keep the
test fast). Attach to each in turn, send input, verify each process
received only its own input.

### M2 — vsock as the control plane (depends on #46 transport)

- Add a virtio-vsock device to the VMM using the transport from
  #46.
- Tiny in-guest daemon that listens on a vsock port, speaks a
  simple JSON-over-newline protocol.
- Supervisor uses vsock for "list processes inside sandbox #3",
  "spawn a child process", "ship a file in".
- Interactive streams still go through the pty.

## What this needs before it starts

- #49 runtime package: the thing we're adding multi-VM to. ✓ started.
- Nothing else blocking for M1.
- #46 transport blocks M2.

## What this unblocks

- Interactive Claude Code across many sandboxes (#48 M2).
- The "I've got 5 agents running; show me #3" workflow that's the
  whole reason machinen exists.
