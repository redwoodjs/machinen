# The GIC redistributor puzzle (open)

We have Linux booting far enough to print its version and start
the interrupt-controller setup. Then it says:

    GICv3: No redistributor present @(____ptrval____)

and panics a few microseconds later. This note documents what we
know, so the next session can start from facts rather than from
re-deriving them.

## What we've figured out

- **Apple's in-kernel GIC needs 32 MB** for its redistributor
  region (`hv_gic_get_redistributor_region_size()` returns
  `0x02000000`). QEMU's default device tree only reserves 15.4 MB
  there, so the kernel's probe reads past the end of HVF's
  backing and sees zeros.
- We now ship a custom device tree (`test-fixtures/virt.dts`)
  with the redistributor at `0x10000000` size 32 MB, away from
  the serial port.
- Apple's hypervisor does **not** auto-route redistributor MMIO
  to its own GIC. The guest's reads/writes to addresses inside
  the redistributor region come through to us as data aborts
  (exit EC 0x24). We confirmed this by tracing: the kernel
  reads `0x1000_ffe8` (redistributor PIDR2) and HVF passes the
  access up instead of serving it.
- The documented relay API (`hv_gic_get_redistributor_reg` /
  `hv_gic_set_redistributor_reg`) returns `HV_DENIED` when we
  try to call it to serve those reads. This is a surprise —
  we have the `com.apple.security.hypervisor` entitlement and
  the distributor-side equivalents work fine (reads of
  `GICD_TYPER` return `988 SPIs implemented`, exactly what the
  kernel reports).
- The companion query `hv_gic_get_redistributor_base(vcpu)` also
  returns `HV_BAD_ARGUMENT`.

## Leading theory

The redistributor is per-vCPU. The APIs that touch it may
require the vCPU to be in a specific state — perhaps "has run
at least once." All our calls happen while the vCPU is paused
at an exit right after the kernel's first access. That timing
could be why `HV_DENIED` / `HV_BAD_ARGUMENT` come back.

Distributor calls don't have this problem because the
distributor is global, not per-vCPU.

## What to try next

1. **Read Apple's real sample.** WWDC has an HVF+GIC sample;
   search `hv_gic_create` on developer.apple.com and in the
   Xcode documentation viewer. Whatever it does at vCPU setup
   time is probably what we're missing.
2. **Look at cloud-hypervisor's HVF backend.** It's Rust; their
   HVF+GIC path in `hypervisor/src/vm.rs` has the right dance.
3. **Try querying the redistributor after the first run.** If
   `hv_gic_get_redistributor_base` starts returning a real
   address only after the vCPU's first `hv_vcpu_run`, that
   confirms the "must run first" theory and we can adjust by
   pre-running a tiny stub before handing over to the kernel.
4. **Try HV*MEMORY*\* flags on the redistributor region.**
   Possibly we're supposed to not call `hv_vm_map` there at all
   (we don't — good) but also set some hint that says "HVF
   owns this region."
5. **Use a newer macOS.** We're on 15.7.4. macOS 14 is the GIC
   v3 minimum; macOS 15 may have fixes. macOS 26 betas may be
   different again.
6. **Fall back to emulating the redistributor ourselves.**
   Read the GICR\_\* register enum, maintain state per-vCPU,
   serve MMIO from our own tables. Lots more code but avoids
   the Apple API black box.

## Small wins to keep regardless

- Our PL011 + PSCI + data-abort plumbing works and handles a
  real kernel's stream of accesses without crashing.
- We now know the kernel prints ~1.5 KB of boot messages
  through our serial port before hitting the GIC wall.
- The custom `virt.dts` is a clean layout we can iterate from.
- The host-side relay for distributor MMIO is in place and the
  kernel successfully reads the distributor TYPER register
  through it.

## Current code state

- `packages/microvm/src/hvf.zig`: has distributor- and
  redistributor-reg relay helpers (`Gic.readDistributor`,
  `Gic.writeRedistributor`, etc.). The redistributor ones
  currently silently fail — ret value is `HV_DENIED`.
- `packages/microvm/src/boot.zig`: routes GIC MMIO to those
  helpers; the run loop reports "No redistributor" because
  the register reads come back zero.
- `test-fixtures/virt.dts`: committed, describes our custom
  GIC + PL011 layout.

Next person can pick this up with the list above and probably
crack it in a focused hour or two.
