# HVF — Hypervisor.framework

Apple's built-in API for running virtual machines on macOS. It's
what you use when you want to run a Linux guest on a Mac and
need hardware acceleration.

## The one-line version

HVF lets a regular macOS program ask the CPU to "run this chunk
of guest code for me, and tell me when something interesting
happens (I/O, a fault, an interrupt)."

## The analogy

Think of the CPU as having two modes: "host" (macOS is running)
and "guest" (a virtual machine is running). HVF is the switch.
You give it memory, a starting address, and initial register
values, then say "go." The CPU runs guest code directly on real
hardware until it hits something it can't handle alone — at that
point it hands control back to you. You handle the event (read
a byte from a virtual serial port, deliver a virtual interrupt,
etc.) and say "go" again.

This is the same basic idea as KVM on Linux. Different APIs,
same mental model.

## Why it matters for machinen

Machinen wants to run Linux guests on a Mac. Three ways to do
that:

1. **User-space emulation** (like old QEMU without acceleration).
   Slow — every guest instruction interpreted by host code.
2. **Kernel extension** (what VirtualBox used to do). Needs a
   kext, which Apple has been deprecating for years. Dead end.
3. **HVF.** User-space program + Apple-blessed API. Near-native
   speed, no kexts, stable. This is the only good answer on
   macOS.

Every microVM/container-adjacent tool you run on a Mac today —
Docker Desktop, OrbStack, Lima, Podman Machine, UTM, Parallels
Lite, cloud-hypervisor — uses HVF underneath. We're just going
to use it directly.

## What a minimal HVF program does

In rough order:

1. **Create a VM.** `hv_vm_create()` — one per process, usually.
2. **Allocate guest memory on the host.** Regular `mmap`, then
   tell HVF "this region is guest-physical RAM."
3. **Map memory into the guest.** `hv_vm_map(host_addr,
   guest_phys_addr, size, flags)`.
4. **Create a vCPU.** `hv_vcpu_create()` — one call per virtual
   CPU the guest will have.
5. **Set initial registers.** `hv_vcpu_set_reg(vcpu, reg, val)`
   for program counter, stack pointer, etc. This is where you
   say "the guest should start executing here."
6. **Run.** `hv_vcpu_run(vcpu)` — blocks until the CPU exits
   the guest.
7. **Handle the exit.** Read `hv_vcpu_get_reg()` / exit reason
   to find out why it stopped. Common reasons: I/O access,
   hypercall, page fault, interrupt.
8. **Loop.** Go back to step 6 until the guest halts or you
   shut it down.

That's the shape of every VMM. Everything else — booting a
Linux kernel, virtio devices, snapshot/restore — is built on
top of this loop.

## arm64 vs x86_64

On Apple Silicon (arm64):
- Register names and layout are ARM-style (X0..X30, SP, PC,
  CPSR, plus system registers).
- Boot protocol: Linux expects you to put the kernel at a
  specific address, the device tree blob (DTB) at another, and
  jump to the kernel with specific registers set (X0 = DTB
  address, rest zeroed).

On Intel Macs (x86_64):
- Register names are x86-style (RAX, RBX, RIP, RSP, CR3...).
- Boot protocol: Linux bzImage format; you set up a specific
  zero-page layout and real/protected-mode transition.

Same HVF API either way — you just use different register
names and different kernel-loading conventions.

## The files you'll see

When writing Zig bindings:
- `/System/Library/Frameworks/Hypervisor.framework/Headers/hv.h`
  — the C header. Defines all the `hv_*` functions and types.
- Related headers: `hv_vm.h`, `hv_vcpu.h`, `hv_error.h`,
  `hv_types.h`.
- Apple's docs:
  <https://developer.apple.com/documentation/hypervisor>

At link time you need `-framework Hypervisor`.

You also need the `com.apple.security.hypervisor` entitlement
on any binary that uses HVF. For `zig build`, this means
signing the output with a self-signed cert or Developer ID,
with that entitlement in a plist. Something we'll hit on the
first real run.

## Linux counterpart: KVM

For the machinen-vmm KVM backend, the equivalent flow is:

- `open("/dev/kvm")` → `ioctl(KVM_CREATE_VM)` instead of
  `hv_vm_create`.
- `ioctl(KVM_SET_USER_MEMORY_REGION)` instead of `hv_vm_map`.
- `ioctl(KVM_CREATE_VCPU)` instead of `hv_vcpu_create`.
- `ioctl(KVM_SET_REGS)` / `KVM_SET_SREGS` instead of
  `hv_vcpu_set_reg`.
- `ioctl(KVM_RUN)` instead of `hv_vcpu_run`.
- Same "run until exit, handle reason, loop" pattern.

Both backends will sit behind one Zig interface in
`packages/vmm/src/root.zig`.

## Further reading worth a pass

- Apple's minimal HVF sample (Swift, but the shape is the
  same): <https://developer.apple.com/documentation/hypervisor/using_apple_virtualization_extensions>
  (note: this is higher-level Virtualization.framework, built
  on HVF — useful for comparison but not what we're using).
- cloud-hypervisor's `hypervisor` crate — their HVF backend
  in Rust is the cleanest reference implementation of a real
  VMM using these APIs.
- `crosvm`'s HVF support — Google's ChromeOS VMM, also
  instructive.
