# Freezing a Node process inside the VMM — what's left

We can boot Linux in our Zig VMM, run Node, run CRIU's binary.
What we can't yet do is `criu dump` → `criu restore` an actual
process end-to-end. This note is a resume-guide for that work.

## What already works (no more investigation needed)

- VMM boots, runs Debian userspace, runs Node (`packages/microvm`
  + `test-fixtures/virt.dts` + the Dockerfile / downloaded-deb
  rootfs path).
- Ticker program (a Node process that counts and prints every
  500 ms) runs inside the guest and its output reaches the
  host through our emulated serial port.
- CRIU's binary runs and prints its version.
- We know exactly which kernel modules CRIU wants (netlink_diag,
  unix_diag, inet_diag, tcp_diag, udp_diag, af_packet_diag —
  the last with caveats below) and we have them all on disk
  in the rootfs at `/lib/modules/<kernel-version>/kernel/net/`.
- `insmod` with direct paths to the .ko files works because we
  bundled it in via the kmod + libkmod2 debs.

## What blocks the freeze/restore, exactly

Two distinct problems we've hit.

### Problem 1: `af_packet_diag` insmod hangs

When we try to load `af_packet_diag.ko`, `insmod` never
returns. We haven't isolated why. In the interim demo.sh skips
it. CRIU will probably warn about packet-socket diagnostics
being absent, but for a guest that only runs Node (no raw
packet sockets), it shouldn't matter.

### Problem 2: loading `inet_diag` freezes the shell

After `insmod inet_diag.ko`, any subsequent shell command
silently produces no output. This one is the blocker.

Our best guess: inet_diag's init path touches IPv4 routing
tables, and with **no network interfaces** in the guest, it
leaves some kernel state half-initialised, which then deadlocks
the next user-space activity that touches netlink.

## The three fixes worth trying, in order

### 1. Bring up a dummy network interface first

Before loading `inet_diag`, run:

```sh
# needs iproute2 in the rootfs
ip link add dummy0 type dummy
ip link set dummy0 up
ip addr add 127.0.0.1/8 dev lo
ip link set lo up
```

If the theory holds, that gives inet_diag something to attach
to. `iproute2` isn't in our current rootfs — add it to the
Dockerfile (or download the `iproute2` .deb and layer it in
the same way we layered kernel-modules).

This is the cheapest fix; **try this first.**

### 2. Kernel with diag features compiled in

Replace `=m` with `=y` in the kernel config for these:

- `CONFIG_INET_DIAG=y`
- `CONFIG_TCP_DIAG=y`
- `CONFIG_UDP_DIAG=y`
- `CONFIG_PACKET_DIAG=y`
- `CONFIG_UNIX_DIAG=y`
- `CONFIG_NETLINK_DIAG=y`

Rebuild the arm64 kernel. ~1 hour on a fast machine. Result:
no `modprobe` / `insmod` needed from inside the guest at all.

Moderate cost, cleanest outcome. Worth doing if fix 1 doesn't
stick.

### 3. Move CRIU out of the guest entirely

Instead of running CRIU inside the guest, dump the guest's
state **from the host side** by reading its memory through
our VMM and snapshotting vCPU registers with `hv_vcpu_get_reg`.

This is what machinen's Tier 1 hot-move actually wants long
term anyway — the freezing and moving is a host operation,
not a guest operation.

What it takes:
- A host-side module in Zig that iterates the guest's memory
  mappings, dumps them + register state, and optionally also
  dumps the DTB + kernel image metadata.
- A corresponding restore path: fresh VMM, load the saved
  memory, restore registers, run.
- This doesn't need any kernel modules inside the guest and
  doesn't depend on CRIU at all.

Big cost (new code), but aligned with the product direction.

## What NOT to do

- Don't try to run `depmod` on macOS to generate the
  `modules.dep` file — macOS doesn't have it and cross-running
  it against an arm64-Linux modules tree is finicky. Stay on
  `insmod` with direct paths until we have a proper build
  environment.
- Don't try to get CRIU working in Alpine — Alpine doesn't
  package CRIU, and building it from source has its own rabbit
  hole of dependencies. Debian slim has been the right choice.
- Don't fight the `cat /log-file` hang in the 346 MB rootfs
  setup. That hang disappears in the smaller rootfs without
  kernel modules. It's likely a tmpfs / page-cache interaction
  with our 2 GB guest and the big unpack; extra RAM or a
  streamed pipe instead of a file-then-cat would side-step it.

## The right next thing to try

Fix #1: add iproute2, bring up a dummy interface, try insmod
inet_diag. ~30 minutes. If it works, the rest of CRIU dump
should follow.

## Environmental recap (so nothing has to be re-derived)

- Guest kernel: Debian's `linux-image-6.1.0-44-cloud-arm64`
  (from linux-signed-arm64 in debian-security pool).
- Guest userspace: `node:lts-slim` Docker image (Debian
  bookworm-slim + Node 24) + `criu` + `kmod` + their deps
  from the apt pool.
- Orbstack / Docker is *not* required for the rootfs. We
  verified we can pull individual Debian `.deb`s with `curl`
  and extract them with `ar` + `tar` on macOS, then layer the
  result into an existing rootfs directory, then cpio-pack it
  with our Python builder (`mkinitramfs.py --rootfs <dir>`).
- Guest RAM: 2 GB (`packages/microvm/src/boot.zig`
  `Config.ram_size`). Device tree at `virt.dts`.
- VMM state: complete; no changes needed for this work.
