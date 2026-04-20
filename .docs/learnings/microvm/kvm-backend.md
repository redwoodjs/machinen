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

## What this commit doesn't do

- **Boot Linux under KVM.** The boot path needs vgic_v3 setup,
  MMIO routing to virtio + PL011 stubs, interrupt injection for
  the arm timer + UART. That's `boot_kvm.zig` and it's substantial.
- **CI exercising KVM.** GitHub ubuntu-latest is x86_64. To run
  the arm64 guest under KVM we need an arm64 Linux runner (Oracle
  Ampere free tier, Graviton, or a self-hosted runner on an M-series
  Mac running Asahi or a nested arm64 Linux). Scaffold shows zig
  compiles + unit tests pass on Linux already — that's the short-term
  CI win.

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
