# microvm architecture — high level

What `@machinen/microvm` is, what's in it, and why each piece exists.
Written for someone who knows software but not VMMs.

## What is a VMM?

A **VMM** (virtual machine monitor) is the host-side program that owns
a guest VM. It allocates guest RAM, loads a kernel into it, creates
virtual CPUs, and emulates the virtual hardware (serial port, disks,
network) the guest expects. The CPU runs guest code natively until it
traps out for something it can't handle alone (an I/O write, a
hypercall) — the VMM handles the event and resumes the CPU.

`@machinen/microvm` is machinen's VMM, written in Zig, shipped as the
platform-specific `@machinen/vmm-<arch>-<os>` binary.
`@machinen/runtime` spawns it per guest.

## The core loop

Every VMM does this, and ours is no exception:

1. Create a VM, allocate guest RAM (one big mmap'd region).
2. Load three blobs into guest memory: kernel `Image`, device tree
   blob (DTB), and initramfs.
3. Create a vCPU. Set `X0 = DTB address`, `PC = kernel entry`. Jump.
4. `run()` until the CPU traps out. Handle the exit reason (MMIO,
   PSCI hypercall, etc.). Resume. Repeat until shutdown.

## Two backends, one interface

The CPU has a "host" mode (macOS/Linux is running) and a "guest" mode
(the VM is running). You need a kernel-blessed API to switch between
them. Each host OS has its own:

- **`src/hvf.zig`** — macOS arm64. Uses Apple's
  `Hypervisor.framework`. Why: the only sanctioned path on macOS —
  kernel extensions are deprecated, and pure user-space emulation is
  too slow. Every Mac container tool goes through HVF.
- **`src/kvm.zig`** — Linux arm64. Uses `/dev/kvm` ioctls. Why: same
  idea, different OS — KVM is Linux's built-in hypervisor interface.

`src/root.zig` picks between them at compile-time via
`detectBackend()`. `src/boot_hvf.zig` / `src/boot_kvm.zig` are the
per-backend kernel loaders — the register ABI at the kernel jump is
the same, but how you set those registers differs per API.

## Device models

The guest kernel boots and probes for hardware. If the device it
expects isn't there, that subsystem stays dead. Each module emulates
one device:

- **`src/pl011.zig`** — PL011 UART. Why: the guest's serial console.
  This is how kernel boot messages and the workload's stdout/stderr
  come out. Shared between the HVF and KVM backends.
- **`src/virtio.zig`** — virtio-MMIO transport + virtqueue plumbing.
  Why: virtio is the standard fast paravirtualized I/O bus. Every
  device below rides on top of it.
- **`src/blk.zig`** — virtio-blk. Why: the guest's disk.
- **`src/vsock.zig`** — virtio-vsock bridge. Why: host↔guest
  **control plane** without TCP/IP. Agents inside the guest (winsize,
  secrets, files) talk to the runtime on the host over this. Mapped
  to Unix-domain sockets via
  `MACHINEN_VSOCK=in:<port>:<path>,out:<port>:<path>`. No DHCP, no
  NAT, no port mapping; survives the guest reconfiguring `eth0`.
- **`src/slirp.zig`** — user-mode networking via `libslirp`. Why:
  gives the guest outbound internet without root privileges or tap
  devices. libslirp is a userspace TCP/IP stack pretending to be the
  outside world.

## What runs inside the guest

The microvm boots a **Debian `node:lts-slim` base rootfs** (Node is
pre-baked because machinen agents target a Node runtime). Inside:

- **`/init`** — machinen's, not Debian's. Mounts `/proc`, `/sys`,
  `/dev`, opens the console, reads `/machinen-config.json`, starts
  the named vsock agents, then `exec`s the user's `cmd`. Ships with
  the base rootfs; users don't override it.
- **vsock agents** — small in-guest helpers the host drives over
  vsock.

The guest is delivered as a **bundle**: `rootfs/` +
`machinen-config.json`. The bundle layout and config schema are
defined by what `/init` reads at boot.

## How this fits the rest of the product

The microvm is _just_ the substrate. `@machinen/runtime` drives it:

- `build()` boots the base rootfs, pipes the user's install steps in
  over vsock, CRIU-freezes the guest, writes a snapshot file.
- `spawn()` restores a snapshot into a fresh microvm.

The microvm itself knows nothing about snapshots, bundles, or agents
— it boots a kernel and brokers virtio traffic. That separation is
the invariant: whatever substrate sits here has to honor the same
contract, no more.

## High-level flow

```
HOST                                       GUEST
─────────────────────────────────────────────────────────────────────

   ┌──────────────────────────┐
   │ @machinen/runtime        │
   │  spawn({ bundle })       │
   └──────────────┬───────────┘
                  │ spawns binary
                  ▼
   ┌──────────────────────────┐
   │ @machinen/microvm (Zig)  │
   │  ┌────────────────────┐  │
   │  │ backend: hvf │ kvm │  │
   │  └─────────┬──────────┘  │
   │            │ load kernel │
   │            │ + DTB       │
   │            │ + initramfs │
   │            │ set X0,PC   │
   │            │ run vCPU    ├──── CPU switches to guest mode ───▶ ┌──────────────────────┐
   │            ▼             │                                     │ Linux kernel boots   │
   │  ┌────────────────────┐  │                                     │   │                  │
   │  │ exit loop:         │  │                                     │   ▼                  │
   │  │  MMIO  ─────────── │◀─┼── virtio-MMIO doorbells ─────────── │ /init (machinen)     │
   │  │  PSCI  ─── off ──▶ │  │                                     │   │                  │
   │  └─────────┬──────────┘  │                                     │   ├─ mount procfs    │
   │            │             │                                     │   ├─ read config     │
   │  ┌─────────┴──────────┐  │                                     │   ├─ start agents    │
   │  │ device models:     │  │                                     │   └─ exec user cmd   │
   │  │  pl011  ──── console  ── serial bytes ──────────────────────▶ stdout/stderr        │
   │  │  virtio-blk ─────── │  │◀── block reqs ─────────────────────│  rootfs I/O          │
   │  │  virtio-vsock ───── │  │◀── control-plane packets ──────────│  vsock agents        │
   │  │  slirp (net)  ───── │  │◀── IP packets ─────────────────────│  eth0 (outbound)     │
   │  └────────────────────┘  │                                     │                      │
   └──────────────────────────┘                                     └──────────────────────┘
         ▲                ▲
         │                │
   stdout/stderr     vsock bridge
   to parent         (UDS paths from
   process           MACHINEN_VSOCK)
```

## Where to look for details

The code is the source of truth. Starting points:

- `../src/root.zig` — backend selection, module map
- `../src/boot_hvf.zig` / `../src/boot_kvm.zig` — kernel + DTB load, vCPU setup
- `../src/hvf.zig` / `../src/kvm.zig` — the two hypervisor backends
- `../src/pl011.zig`, `../src/virtio.zig`, `../src/blk.zig`,
  `../src/vsock.zig`, `../src/slirp.zig` — device models
- `../test-fixtures/init.zig` — the guest `/init`
- `../../runtime/src/index.ts` — how the VMM gets driven from Node
