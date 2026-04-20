# How an arm64 Linux kernel expects to be started

The short version: our VMM has to put three things in the guest's
memory (the kernel, a small description of the virtual hardware,
and optionally a tiny starter filesystem), set one register, and
jump.

## The three things we have to hand the kernel

1. **The kernel image itself.** On arm64 this is a file called
   `Image` — basically a flat blob that starts with a 64-byte
   header telling us things like "load me at this offset" and
   "I need this much RAM for my own working memory." Not a PE/ELF
   file: the kernel unpacks itself once it starts running.

2. **A device tree blob (DTB).** A small binary describing what
   virtual hardware exists: how much RAM there is, how many CPUs,
   where the serial port lives, what it's compatible with. Linux
   on arm64 uses this instead of an ACPI BIOS or command-line
   flags. About 2 KB once compiled from its text format.

3. **An initial filesystem (optional for early bring-up).** A cpio
   archive the kernel unpacks into RAM and mounts as `/`. Gives
   the kernel somewhere to look for `/init`, which is the first
   program it runs after boot.

## The one register that matters at boot

When we jump to the kernel's entry point, exactly one register
has to hold meaningful data: **X0 = the guest-physical address of
the DTB**. Everything else the kernel will figure out on its
own.

X1, X2, X3 are reserved for future use — set them to 0 to be
safe. PC obviously goes to the kernel entry.

The CPU should be in EL1 with the MMU off, just like in the
instruction-execution tests. If you skip this the kernel's
first few instructions might succeed but then it'll blow up
trying to enable its own page tables.

## The Image header

The first 64 bytes of the kernel file look like this:

```
offset  size  field                    meaning
------  ----  -----------------------  --------------------------------
0x00    4     code0                    an arm64 "b" instruction that
                                       jumps over the header
0x04    4     code1                    reserved (historically used)
0x08    8     text_offset              where in memory the kernel
                                       wants to be placed, relative to
                                       the base of RAM
0x10    8     image_size               how many bytes of RAM the kernel
                                       needs (often larger than the
                                       file on disk — extra is zeroed)
0x18    8     flags                    endianness, page size hints
0x20    24    reserved                 zeros
0x38    4     magic                    "ARM\x64" (0x644d5241) — sanity
                                       check the file is actually an
                                       arm64 Image
0x3c    4     reserved                 zero
```

Practically: open the file, check the magic, read `text_offset`,
copy the whole file into guest RAM at `ram_base + text_offset`,
jump there with X0 = DTB address.

## What the device tree blob has to say

Minimum nodes for a kernel to come up on arm64:

- `/memory`: where RAM is and how big it is. E.g., "there's 256
  MB of RAM at guest-physical address 0x40000000."
- `/cpus/cpu@0`: one CPU, compatible with ARMv8.
- `/psci`: tells the kernel how to power on more CPUs or reset
  the system (described below).
- `/chosen`: the kernel command line (e.g., `console=ttyAMA0`)
  and, if we're loading one, where the initramfs is in memory.
- `/pl011@9000000`: the serial port we emulated earlier, so the
  kernel knows where to write its boot messages.
- `/timer`: the architected timer the kernel uses for scheduling
  ticks.

The DTB's binary format is a small tree encoded as a specific
blob. We can either ship the text source (`.dts`), compile it
with `dtc`, and embed the result; or we can generate it in Zig.
For v1, writing and embedding a static DTS is simpler.

## PSCI — the one kernel-to-hypervisor call that matters

PSCI ("power state coordination interface") is the standard way
an arm64 kernel asks the firmware or hypervisor to do things
like "turn on another CPU," "power off the machine," or "reset."

It's implemented as **HVC #0** — the same instruction we've
already been trapping — with a specific function ID in X0 that
tells us what the kernel wants:

| Function ID  | What the kernel wants                     |
| ------------ | ----------------------------------------- |
| `0x84000009` | system off (the kernel is shutting down)  |
| `0x84000008` | system reset                              |
| `0xc4000003` | CPU on (start another vCPU at an address) |

For a single-CPU boot we mostly just need to handle "system off"
so we can exit the run loop cleanly when the kernel is done.

When we catch an HVC with one of these function IDs in X0, we
do the action and either stop the vCPU or resume it.

## The flow, end to end

1. Allocate guest RAM as one big region.
2. Read the kernel file from disk. Check the magic.
3. Copy the kernel into guest RAM at `ram_base + text_offset`.
4. Copy the DTB into guest RAM somewhere it won't be clobbered
   by the kernel (convention: just below the kernel, or at the
   end of RAM). Remember that address — that's what goes in X0.
5. If we have an initramfs, copy it in too and patch the DTB's
   `/chosen` node with its address and size.
6. Create the vCPU. Set CPSR to EL1h (as we've been doing).
7. Set SCTLR_EL1 to have the I bit on (MMU stays off — the
   kernel turns it on itself).
8. Set X0 = DTB address.
9. Set PC = `ram_base + text_offset`.
10. Run. In the exit loop, handle PL011 writes → stdout, PSCI
    calls → lifecycle, any other stage-2 faults → diagnose.

That's a Linux boot. The hardest parts are getting the DTB
right and keeping the boot messages flowing long enough to tell
us what's wrong when it doesn't work.

## Useful reference material

- Linux kernel source: `Documentation/arm64/booting.rst` —
  authoritative, not long.
- The Image header format: `arch/arm64/include/asm/image.h`.
- DTB binding reference: `Documentation/devicetree/bindings/` —
  lots of pages, skim for `arm,armv8`, `arm,pl011`, `arm,psci`.
- PSCI spec: ARM DEN 0022 — the function ID encoding is in
  section 5.
- A small hand-written DTS for the ARM virt machine is a useful
  starting point; `qemu -M virt -machine dumpdtb=virt.dtb`
  produces a real working one.
