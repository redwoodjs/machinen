# Workspace filesystem in the Zig VMM — design note + plan

Covers issue #47. The guest's whole filesystem is the initramfs today —
RAM-backed, rebuilt at VMM-build time, thrown away on shutdown. For
sandboxed agents we need a real filesystem that either persists or is
shared with the host.

## Why this is smaller than it looks

We already plan to bring up virtio-MMIO transport for #46 (virtio-net).
Once that's in place, adding another virtio device is cheap: same
transport, different device ID, different device model.

The two reasonable choices:

- **virtio-blk** — present a host file as a block device; guest
  formats it with ext4 and mounts it. Simple device model, already
  well-documented. Good for "a sandbox with persistent state."
- **virtio-fs** — shared-folder semantics; guest sees a host
  directory as a mountable filesystem. Much better for "open this
  repo inside the sandbox" — no copying, edits land straight on the
  host. But needs virtiofsd (a userspace daemon), FUSE-over-virtio
  messages, permission mapping. Heavier.

## Proposed order

### M1 — virtio-blk (ship this first)

- Add a `virtio_mmio@<addr2>` node to `virt.dts` for a block device.
- Device model: reads/writes blocks from a host file.
- Guest-side: kernel's `virtio_blk` driver binds, device shows up as
  `/dev/vda`.
- Format once: host pre-creates an ext4 filesystem in the file with
  `mkfs.ext4 workspace.img`. Guest mounts it at `/workspace`.

Done-when: mount a known file into the image, start the VM, see that
file from inside; write a new file, stop the VM, see the new file on
the host image.

Tests: a `smoke.sh fs` mode that rounds-trips: writes a magic string
to `/workspace/hello` from inside the VM, shuts down, re-mounts the
image on the host, asserts the magic string is there.

### M2 — virtio-fs (for the CC-friendly flow)

Deferred. Skip until we feel the pain of block-device semantics (slow
filesystem changes to reflect, separate image lifecycle). If the
workflow becomes "spin up a VM for each task, point it at the repo,"
virtio-fs is nicer; if it's "each agent gets a persistent volume,"
virtio-blk is fine.

## Risks

- macOS host as image backend: we need to open the host file with
  flags that make writes durable on VM shutdown. macOS has some
  async-write weirdness around `F_FULLFSYNC`; worth a real fsync on
  VM exit.
- Concurrent access: two VMM instances pointing at the same image
  file would corrupt it. Not blocking for v0.1 (one VM at a time
  until #49/#51 land), but worth a file lock.
- Image resizing: ext4 has sizing constraints. Fix image size at
  creation.

## What this unblocks

- #48 — CC in the rootfs can now edit a real project.
- #50 — snapshot-restore flows need a place to put per-sandbox
  state. virtio-blk gives them one.
