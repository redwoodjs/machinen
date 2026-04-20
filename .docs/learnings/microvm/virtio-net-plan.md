# virtio-net in the Zig VMM — design note + plan

Covers issue #46. The guest has no network today; this lays out what
shipping it actually involves, in plain language, so the next person
(or next session) can pick it up without re-deriving the space.

## Why this is a big piece of work

Emulating virtio-net from scratch means three layers of protocol, not
one. Each has its own state machine. Getting the kernel to bind the
driver is already several hundred lines of Zig; getting packets to
actually flow is several hundred more. Realistically: multiple
sessions, not one.

Layer 1 — **virtio MMIO transport**. The bus. Registers at fixed
guest-physical addresses that the kernel pokes: magic value, device
ID, version, feature bits, queue config, doorbell (queue notify),
status (device state machine), interrupt status/ack. Think of it as
the PCI equivalent for memory-mapped-only worlds.

Layer 2 — **virtqueue**. A split ring buffer in guest memory. Three
parts per queue: a descriptor table (host reads these to find the
buffers), an available ring (guest tells host which descriptors are
ready), a used ring (host tells guest which it's done with).
Endian-little, 16-byte descriptors, padding rules matter.

Layer 3 — **the virtio-net device model**. Two queues: RX (guest
supplies buffers, host fills with incoming packets) and TX (guest
fills with outgoing packets, host sends). Optional control queue for
MAC/link state. A 10-byte per-packet header.

Plus a **host-side backend** — actual packet plumbing. Two paths:

- **tap + NAT**: clean isolation, but on macOS needs root or the
  `feth`/`utun` interfaces + socket-filter privileges. Fiddly.
- **user-mode slirp**: a userspace TCP/IP stack that pretends to be
  the outside world and opens real sockets on behalf of the guest.
  No privileges. QEMU's libslirp is the reference. Simpler to
  integrate as a first pass.

## Proposed milestones

Small, each independently committable and testable.

### M1 — kernel binds the device (no packets flow yet)

- Add a minimal virtio-MMIO register window to the VMM's MMIO
  dispatch. Return the magic value (`0x74726976`), version 2,
  device ID 1 (net), vendor 0, some feature bits the kernel likes
  (`VERSION_1`, `MAC`).
- Add a `virtio_mmio@<addr>` node to `virt.dts` and rebuild
  `virt.dtb`.
- Implement just enough of the status-register state machine for
  the kernel to reach DRIVER_OK without aborting.
- No virtqueues, no packets. Kernel will probably print
  "virtio_net: no queues, skipping" or equivalent. That's fine for
  this milestone.

Test: `dmesg` inside the guest mentions the virtio device and the
driver probe doesn't produce an error. Smoke: add a marker to
fork-demo.sh / another demo shell that `ip link` shows something
besides `lo`, or skip if zero hardware support — either way, the
kernel's probe path must succeed.

### M2 — virtqueue plumbing, null backend

- Parse the guest-posted descriptor + avail rings.
- Service TX: read each descriptor chain, drop the packet, post a
  used entry.
- Service RX: take a queued buffer, fabricate a fake inbound
  packet (e.g. one ARP reply), post it.

Test: kernel says `eth0: link up`. `ip link set eth0 up` succeeds.
Nothing useful flows yet — but the queue machinery is proven.

### M3 — real outbound via slirp (or tap)

- Replace the "drop" TX path with "hand to the host backend."
- Replace the "fake packet" RX path with "deliver real incoming
  bytes from the backend."
- DHCP or a static config inside the guest (probably static — one
  less moving piece during bring-up).

Test: `curl -sI https://api.anthropic.com` from inside the guest
returns an HTTP response (even a 4xx). That's the done-when for
#46.

## Host-side backend: which one first?

Pick **user-mode slirp-style** for M3. Reasons:

- No privileges needed. The VMM process opens regular sockets.
- No kernel extensions on macOS.
- Users don't have to set up tap interfaces or bridges.
- Easy to point at a specific host IP / port restrictions later
  (matters for sandboxing Claude Code).

Downside: implementing slirp is non-trivial if we write it from
scratch. But: we can start with TCP-only, IPv4-only, SYN-based
stateless translation — just enough for HTTPS to api.anthropic.com
to work. DNS we can proxy statelessly too. That's much less code
than a real TCP/IP stack.

Alternative: shell out to `socat` / `ss-redir` / a tiny Go/Rust
companion. Considered a fallback if writing Zig slirp is worse than
the integration tax.

## Testing plan

Parallels the microVM's existing structure:

- **Unit tests in Zig** — virtqueue descriptor parsing with hand-
  crafted memory blobs. No HVF needed, no guest.
- **Unit test for MMIO register reads/writes** — feed the MMIO
  dispatcher a known register write, assert state change.
- **Integration smoke** — new mode in `test-fixtures/smoke.sh net`
  that asserts `ip link show eth0` succeeds (M2), and eventually
  that `curl` talks out (M3).

## What this unblocks

- #47 — workspace filesystem. Once virtio-MMIO transport exists,
  adding virtio-blk or virtio-fs is cheap (same transport, different
  device ID + device model).
- #48 — CC in the rootfs. Needs network to reach api.anthropic.com.
- By extension #50 and #51 get closer to useful.
