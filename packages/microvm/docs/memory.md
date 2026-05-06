# microvm memory — host RSS and the guest RAM ceiling

How guest RAM is allocated, what the configured `ram_size` actually
costs the host, and what it would take to make the host footprint
shrink as well as grow.

## What `ram_size` is

`Config.ram_size` is the size of the contiguous host mapping handed
to the hypervisor as the guest's physical RAM. The default is 4 GiB
(`boot_hvf.zig`, `boot_kvm.zig`). The guest kernel sees this as
`MemTotal` and sizes its page tables, slab caches and zone metadata
against it at boot.

It is a **ceiling**, not a **commitment**. The host does not pay 4 GiB
of RSS up front to give the guest a 4 GiB ceiling.

## How the mapping is made

Both backends do the same two-step:

1. `mmap(NULL, ram_size, PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANONYMOUS)`
   — anonymous, private, demand-paged. No physical pages are
   committed at this point on either Darwin or Linux. Reads see the
   zero page (CoW); first write triggers a page fault that
   zero-fills a real page.
2. The hypervisor is told to use that range as guest physical RAM:
   - HVF: `hv_vm_map(host_ptr, guest_phys, size, RWX)`
   - KVM: `KVM_SET_USER_MEMORY_REGION` (via `vm.mapMemory`)

   Neither call wires or pre-faults the range. Both just register a
   stage-2 (IPA → PA) translation. Stage-2 faults from the guest
   propagate through the host kernel and resolve through the
   pre-existing anonymous vm_map / VMA — same lazy zero-fill path as
   any host process.

The upshot: **host RSS scales with what the guest has touched, not
with `ram_size`.**

## Measured on Apple Silicon (HVF, 16 KiB pages, 4 GiB ceiling)

| Stage                                         | Host VMM RSS | Guest MemFree            |
| --------------------------------------------- | ------------ | ------------------------ |
| Idle, post-boot                               | **302 MiB**  | 3884 MiB (of 3919 total) |
| After guest writes 512 MiB to tmpfs           | **987 MiB**  | (512 MiB consumed)       |
| After guest `rm` + `echo 3 > .../drop_caches` | **1040 MiB** | back to 3886 MiB         |

VSZ holds steady at ~415 GiB throughout — the 4 GiB guest mapping is
present in the address space the whole time, but only the touched
portion is resident.

Three things this confirms:

1. **Lazy commit works on HVF.** Idle RSS is 302 MiB, not 4 GiB. The
   hypervisor framework does not wire the mapping.
2. **Grow-on-demand is automatic.** A 512 MiB guest write produced a
   ~685 MiB RSS bump. The extra above 512 MiB is stage-2 page
   tables, kernel buffers around `dd`/`sync`, and 16 KiB page-
   granularity rounding.
3. **There is no shrink path.** Freeing every guest byte and
   dropping caches did not release a single host page. Once a page
   has been zero-filled by a stage-2 fault, the host has no
   visibility into the guest knowing it's free again. RSS only falls
   when the VMM exits and `munmap` runs.

KVM behaves the same way; the `MAP_ANONYMOUS` semantics are
identical and the `KVM_SET_USER_MEMORY_REGION` call is even more
clearly a translation-only operation than HVF's.

## Why "memory grows and shrinks as needed" needs a balloon

The natural read of "shrink as needed" is that idle guests should
return memory to the host. The host kernel cannot do this on its
own: the anonymous page is _resident_, owned by the VMM process,
and no Linux/Darwin reclaim heuristic knows that the guest kernel
has marked the corresponding guest physical page as free.

The standard fix is a **virtio-balloon** device:

1. Guest driver pins free pages into a "balloon" array.
2. VMM walks the array, calls `madvise(addr, len, MADV_DONTNEED)`
   on the corresponding host range. The host kernel drops the
   physical pages; the next guest read returns the zero page.
3. To "deflate," the guest just stops referencing those pages and
   re-uses them; first re-touch zero-fills again.

A modern variant — **free-page-reporting** (Linux 5.7+) — has the
guest proactively tell the VMM about free runs without the
inflate/deflate ping-pong. Same `MADV_DONTNEED` mechanic on the host
side; less pressure on the guest allocator.

`virtio-mem` is a third option that hot-plugs/un-plugs whole memory
blocks. Powerful, but more complex than this codebase needs.

None of these are wired up in `@machinen/microvm` today: the device
list in `boot_hvf.zig` / `boot_kvm.zig` is `blk` + `net` + `vsock`.

## Initramfs scan window: a related growth trap

The kernel scans `[initrd-start, initrd-end)` for concatenated cpio
archives at boot. If the DTB declares the full ceiling-sized window
but the cpio is small, the scan touches every page and pulls them
all into RSS. `boot_hvf.zig`'s `patchDtbInitrdEnd` rewrites the
DTB's `linux,initrd-end` to just past the actual cpio for exactly
this reason — without it, idle post-boot RSS would be much closer
to `ram_size` than to "what the guest actually uses."

If `ram_size` is raised, `patchDtbInitrdEnd` keeps lazy commit honest;
removing it would re-introduce the trap.

## Practical guidance for tuning `ram_size`

- The ceiling is approximately free until touched, on both backends.
  Setting it too low caps real workloads; setting it too high costs
  only some address-space VSZ and a bit of kernel-side bookkeeping.
- Be wary of the high-water mark: long-lived VMs that briefly spike
  to N MiB will hold N MiB of RSS until they exit. Without a
  balloon, sizing for the spike means paying for the spike forever.
- 16 KiB page granularity on Apple Silicon means RSS moves in 16 KiB
  steps; small allocations round up.

## Prior art — how other VMMs handle this

Three families of solutions appear in the wild. Most projects pick from
the first; large-scale platforms combine multiple.

### Cooperative-guest reclaim

The guest tells the host which pages it isn't using. Host calls
`madvise(MADV_DONTNEED)` (or the platform equivalent) to drop them. Three
flavours:

- **virtio-balloon** — guest driver pins free pages into a balloon array
  and posts to a virtqueue. Inflate/deflate is host-driven ("give me 2 GiB
  back"). Decades old, well-understood, has overhead. Used by QEMU/KVM,
  Cloud Hypervisor, Firecracker, VirtualBox, Parallels, VMware (proprietary
  driver).
- **Free-page-reporting** (Linux 5.7+, 2020) — guest proactively reports
  free runs without the inflate ceremony. Same host-side mechanic, lighter
  on the guest. Cloud Hypervisor and recent QEMU support it. The modern
  default for new code.
- **virtio-mem** (Linux 5.8+, 2020) — full memory hot-plug. Guest grows
  and shrinks in fixed-size blocks. More flexible than balloon, more
  complex (guest needs memory-zone plumbing). Cloud Hypervisor champions
  it; QEMU supports it. Overkill for short-lived VMs.

Hyper-V's **Dynamic Memory** is the proprietary equivalent, combining
balloon + hot-add via integration services. WSL2 uses it.

### Host-side dedup

Useful when many similar VMs share a host — guests don't know the host
is sharing pages.

- **KSM** (Kernel Samepage Merging) in Linux: a kernel thread scans
  anonymous memory for identical pages and merges them CoW. Massive
  payoff with 50 VMs running the same rootfs; ~zero payoff with one VM.
- **VMware Transparent Page Sharing** — same idea, predates KSM. Scaled
  back in modern ESXi for security (it leaked information across VMs via
  timing side-channels).

Orthogonal to ballooning. Most multi-tenant platforms use both.

### Host-side compression / swap

Last resort when the host runs out of memory and the guests can't
cooperate fast enough.

- **VMware Memory Compression** — compresses cold pages in RAM before
  swapping. Faster than disk swap, slower than just having the page.
- **zswap / zram** on Linux — same idea, transparent to the VMM.
- **Hypervisor swap-to-disk** — the guarantee-of-last-resort. Catastrophic
  for performance, but lets the host stay up under overcommit.

### Where each project lands

| Project                            | Model                                    | Notes                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Firecracker**                    | virtio-balloon (opt-in)                  | Closest analogue to machinen — short-lived MicroVMs over KVM. Added balloon specifically for snapshot/restore workloads where RSS held the high-water mark. Lazy commit on by default. |
| **Cloud Hypervisor**               | virtio-mem + free-page-reporting         | The "modern" reference design. Their stance: virtio-mem is cleaner than balloon.                                                                                                       |
| **QEMU/KVM**                       | balloon, virtio-mem, KSM, DIMM hot-plug  | Supports everything; complexity is on the operator.                                                                                                                                    |
| **WSL2**                           | Hyper-V Dynamic Memory                   | Famously had a "grows but never shrinks" bug for years until kernel work landed (MGLRU + balloon tuning).                                                                              |
| **Apple Virtualization.framework** | None                                     | The high-level macOS framework UTM and Lima can use does not expose ballooning. Fixed ceiling. Same problem this doc describes.                                                        |
| **VMware ESXi**                    | balloon + page sharing + compress + swap | The "throw everything at it" approach. Multi-tenant focus.                                                                                                                             |
| **gVisor**                         | N/A                                      | Different model — user-space kernel intercepting syscalls, not a VM in this sense.                                                                                                     |

### Two takeaways for machinen specifically

1. **Firecracker is the right comparison.** Same use case (short-lived
   MicroVMs over KVM/HVF), same starting problem (lazy-commit grow but no
   shrink), same answer (virtio-balloon, opt-in). They did not pursue
   virtio-mem.
2. **Firecracker's balloon driver is conservative on purpose.** They batch
   `MADV_DONTNEED` and rate-limit it — naive "drop everything immediately"
   is measurably bad because cold-start latency on the _next_ page touch
   spikes. Worth copying that policy if/when balloon lands here.

A bonus observation: Apple's `Virtualization.framework` not exposing
balloon is the reason Lima-on-vz and UTM-on-vz feel memory-hungry compared
to their QEMU equivalents. machinen uses HVF directly (not the
higher-level framework) so it _can_ implement balloon — framework-bound
projects can't.

## Summary

- **Grow-as-needed** up to the configured ceiling already works on both
  HVF and KVM. No code change required.
- **Shrink-as-needed** requires a balloon (or free-page-reporting, or
  virtio-mem). The microvm device list does not include one today; adding
  one is a real piece of work that touches the virtio device layer on both
  backends and depends on the guest kernel's `CONFIG_VIRTIO_BALLOON`.
- **Industry consensus** for VMMs in this niche is virtio-balloon (or its
  free-page-reporting variant), per Firecracker and Cloud Hypervisor.
