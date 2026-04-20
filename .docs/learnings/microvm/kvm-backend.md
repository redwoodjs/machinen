# KVM backend — scope + status

First step toward running the VMM on Linux (production + CI target).
This commit lands the ioctl scaffold — the KVM twin of `hvf.zig` —
plus a proof-of-life test. It does **not** yet boot Linux via KVM;
that's the next session's work.

## What's platform-agnostic already

These compile + run on both backends without changes:

- `virtio.zig` — generic virtio-MMIO device model (net, blk, vsock
  all ride on this).
- `vsock.zig` — host↔guest stream bridge.
- `blk.zig` — virtio-blk backend.
- `slirp.zig` — libslirp user-mode NAT (needs libslirp shared lib
  on the host; apt-get on Debian).
- guest-side rootfs, kernel Image, `virt.dts`, CRIU flow — all
  hypervisor-independent (validated experimentally on Proxmox
  QEMU-TCG in the #50 comment).

## What's platform-specific

These are the only places the two backends differ:

1. VM + vCPU lifecycle (create, destroy, run)
2. Guest-RAM mapping
3. vCPU register get/set
4. vCPU exit decode (MMIO / system-event / WFI)
5. Interrupt controller (GIC v3) setup + irq line injection

All of (1)-(5) already live in `hvf.zig` for macOS. This commit
adds `kvm.zig` for Linux with the same surface names.

## Current kvm.zig shape

`Kvm.open_()` → opens `/dev/kvm`, checks API v12, reads
`KVM_GET_VCPU_MMAP_SIZE`.

`Kvm.createVm()` → `Vm{ fd }`.

`Vm.mapMemory(slot, gpa, host_buf)` → wraps `KVM_SET_USER_MEMORY_REGION`.

`Vm.preferredTarget()` → `VcpuInit` for `KVM_ARM_VCPU_INIT`.

`Vm.createVcpu(id)` → `Vcpu{ fd, run_page }` with the kvm_run page
mmapped.

`Vcpu.init(target)` → `KVM_ARM_VCPU_INIT`.

`Vcpu.setReg(id, value)` / `Vcpu.getReg(id)` → `KVM_{SET,GET}_ONE_REG`
wrapped.

`Vcpu.run()` → `KVM_RUN`, returns `ExitReason`.

`Vcpu.mmioExit()` → reads the mmio payload from the kvm_run page
when the exit reason is `.mmio`.

## The ioctl numbers are compile-time derived

Every `KVM_*` constant is built from `_IOC` macros applied to the
actual Zig struct size. If a struct drifts from the kernel ABI the
ioctl number changes, the kernel rejects with -EINVAL, and the unit
tests that lock the numbers against their documented values fail.

## Proof-of-life test

`test "KVM proof-of-life: create VM, create vCPU, map + run one instr"`:

1. Skip cleanly on macOS, or when `/dev/kvm` isn't readable, or on
   non-arm64 hosts.
2. Open KVM, create a VM, mmap an anonymous 4 KiB page, fill it
   with a single arm64 `wfi` instruction (0xD503207F), map it at
   guest phys 0x40000000.
3. Create vCPU 0, query `PREFERRED_TARGET`, `VCPU_INIT`.
4. Set `PC = 0x40000000`, run. vCPU parks on WFI, kvm reports a
   clean exit. Plumbing proven.

Equivalent to what `hvf.test.hv_vm_create and destroy` +
`hvf.test.map a page, run hvc #0, observe exception exit` gave us
on macOS.

## `boot_kvm.zig` (now present)

Parallel of `boot.zig` on the Linux side. Same kernel, same DTS,
same rootfs, same boot protocol. Differences are all local to this
file:

- Memory via `KVM_SET_USER_MEMORY_REGION` instead of `hv_vm_map`.
- In-kernel vgic-v3 via `KVM_CREATE_DEVICE` + `KVM_DEV_ARM_VGIC_GRP_ADDR`
  for distributor (0x0800_0000) + redistributor (0x1000_0000),
  `KVM_DEV_ARM_VGIC_CTRL_INIT` after vCPUs exist.
- PSCI in-kernel: `KVM_ARM_VCPU_PSCI_0_2` feature bit on
  `KVM_ARM_VCPU_INIT`. HVC #0 calls from the guest are served by
  the kernel; we only see `KVM_EXIT_SYSTEM_EVENT` on shutdown/reset.
- Arm virtual timer is built into KVM — no host-side plumbing.
- PL011 via `pl011.zig` (shared with HVF), driven by
  `KVM_EXIT_MMIO` events. `writeMmioReadData` on the Vcpu pokes
  the read-back value into `kvm_run.mmio.data[...]` before the
  next `KVM_RUN`.
- Virtio not wired yet — currently reads return 0. Enough to watch
  the kernel boot through console; devices follow.

## What this still doesn't do

- **Exercise the KVM path at runtime.** Our CI + the local Proxmox
  are both x86_64; KVM on x86 can't host an arm64 guest (different
  ISA). The test skips gracefully on non-arm64 hosts. Actually
  running the boot needs an arm64 Linux host — Oracle Ampere free
  tier, AWS Graviton, Hetzner arm64, or Asahi Linux on an M-series
  Mac are the cheapest/most-accessible paths. Once one of those is
  available: `MACHINEN_BOOT_TEST=1 zig build test` exercises the
  boot end-to-end.
- **Virtio (net/blk/vsock) under KVM.** The device models are
  already pure-Zig and platform-agnostic; wiring them up behind
  `KVM_EXIT_MMIO` is mechanical. Skipped in the scaffold to keep
  the first boot commit focused.
- **Multi-vCPU.** Just 1 vCPU today. KVM requires creating all
  vCPUs before `GIC.finalize()`; easy extension later.

## Why compile-time \_IOC over hand-hex constants

Every KVM wrapper in the wild (Rust kvm-bindings, Go kvm-ioctls,
the kernel's own selftests) either uses a generator or hand-hexes
the numbers with a comment about what they mean. Hand-hexing drifts
as soon as you rename a struct field by a single byte — silent
sign-off.

Computing `KVM_SET_USER_MEMORY_REGION = _IOW(KVMIO, 0x46,
@sizeOf(UserspaceMemoryRegion))` means you can't compile Zig code
whose struct disagrees with what the kernel expects. The unit test
locks the number against its documented value as an extra
belt-and-braces — if somebody pads the struct accidentally, both
checks fail before the VMM ever calls into the kernel.

## References

- Linux: `Documentation/virt/kvm/api.rst` — the source of truth for
  each ioctl and its payload struct.
- `include/uapi/linux/kvm.h` — the struct layouts.
- `arch/arm64/include/uapi/asm/kvm.h` — arm64-specific bits
  (VCPU_INIT feature flags, core reg encoding).
