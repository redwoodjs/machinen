# Why our Linux boot parks silently (and what fixes it)

We got far enough to load a real arm64 Debian kernel, hand it
the device tree, jump to its entry point, and watch it execute.
We saw it make three hypervisor calls: ask us what PSCI version
we are, ask about CPU migration, then immediately reset.

Zero bytes come out of the serial port even with
`earlycon=pl011,0x9000000` in the kernel command line.

## The smoking gun: it's waiting, not crashing

When we extended the run loop with tracing, the kernel's third
hypervisor call was `SYSTEM_RESET` — it gave up. The traces
before that don't show anything unusual. No stage-2 faults, no
weird register reads, just three PSCI calls.

When we ran with more patience, the vCPU stopped returning
from `hv_vcpu_run` at all. 0% CPU usage, 5 MB resident, no
progress. This is the signature of a guest CPU that issued
the `WFI` ("wait for interrupt") instruction. The real arm64
hardware would stop until some interrupt arrived; HVF mimics
this by pausing the vCPU until the host injects one.

We don't inject any. So it hangs.

## What the kernel actually needs

Three pieces we haven't built:

1. **An interrupt controller (GIC).** Linux thinks there's a
   GIC v3 at a specific address range because the device tree
   we handed it says so. The kernel's early boot reads the GIC
   version register and initializes the controller. Our run
   loop answers all reads from unmapped regions with 0, which
   is "we don't support this" — Linux handles that, but can't
   register any interrupts without a real one.

2. **A virtual timer.** The arm64 architecture has a CPU-local
   timer the kernel uses for scheduling ticks. HVF exposes it
   via system registers and a "vtimer activated" exit reason.
   We have to: set the timer's frequency at boot, wake the vCPU
   when the timer fires, and raise a timer interrupt via the
   GIC.

3. **Interrupt injection.** When the GIC decides an interrupt
   is pending and the kernel has enabled it, the host has to
   tell HVF via `hv_vcpu_set_pending_interrupt` that an IRQ is
   waiting. The vCPU then takes the interrupt on its next
   run, vectoring through the kernel's exception table at
   VBAR_EL1 + 0x280.

Of the three, the GIC is the biggest — emulating even a
minimum v3 GIC is a few hundred lines: distributor registers,
redistributor per-CPU state, SGI/PPI/SPI routing. There's a
fourth option: HVF has built-in GIC emulation exposed via
`hv_gic_*` APIs (macOS 13+), which saves us writing it
ourselves. That's the pragmatic route.

## Plan sketch

1. Turn on HVF's in-kernel GIC via `hv_gic_create` at VM
   creation time. Gives us a working GIC v3 for free.
2. Configure the vtimer at vCPU setup: set `CNTFRQ_EL0` to
   24 MHz (what QEMU virt uses), leave control disabled; the
   kernel enables it during boot.
3. In the run loop, handle the `vtimer_activated` exit reason:
   call `hv_vcpu_set_vtimer_mask(vcpu, true)` to deactivate
   it, then raise the per-CPU IRQ 27 (the arm64 vtimer PPI) on
   the GIC. Next `hv_vcpu_run` will deliver the interrupt.
4. Keep handling our PL011 writes and PSCI calls as before.

This is roughly one more day of work. Once it's in, the Linux
kernel should get past WFI and start printing its boot
messages through the PL011 we already have.

## Less urgent follow-ups

- **virtio-blk / virtio-net.** Even after boot prints are
  flowing, the kernel will complain about having no root
  filesystem. Either give it an initramfs it can unpack into
  RAM, or emulate a virtio-blk device that serves a disk file.
- **A graceful WFI handler.** If we ever want to run workloads
  that legitimately idle (not kernels booting), we need an
  explicit WFI trap + wake-on-host-input path.
- **PSCI `cpu_on`.** Our skeleton returns "not supported."
  The kernel handles single-CPU fine, but multi-CPU guests
  need real CPU-bring-up.
