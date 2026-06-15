# microvm memory — host RSS and the guest RAM ceiling

How guest RAM is allocated, what the configured ceiling actually
costs the host, and how the host footprint shrinks as well as grows.

## User model: capacity without up-front reservation

Use `resources.memory` when you want to state memory as a resource goal:

```ts
await boot({
  resources: {
    memory: {
      maxMib: 4096,
      reclaim: "auto",
    },
  },
});
```

- `maxMib` is the guest-visible RAM ceiling. The guest can grow into
  this capacity, but the host does not reserve the full ceiling as RSS
  at boot.
- `reclaim: "auto"` uses Machinen's always-on virtio-balloon
  free-page-reporting path. When the guest frees pages and Linux
  reports those free runs, the VMM calls `madvise` so the host can stop
  charging those pages to the VM footprint.
- `memory: 4096` remains a compatibility/debug alias for
  `resources.memory.maxMib`; prefer the resource shape in user-facing
  code and docs.

`vm.memoryStats()` reports the pieces users should compare:

- `ceilingMib` — the configured capacity ceiling.
- `hostRssBytes` — the host footprint currently charged to the VMM
  (`phys_footprint` on Darwin when available, VmRSS on Linux).
- `balloonReclaimedBytes` — bytes returned through balloon
  free-page-reporting. `balloonInflatedBytes` is kept as an old-name
  alias for the same counter.

The product promise is not "idle VMs always reach single-digit MiB".
Kernel metadata, page tables, device buffers, and the guest's active
working set still cost memory. The promise is: a large ceiling provides
room to grow without reserving that ceiling up front, and temporary
spikes can be reclaimed after the guest frees pages and reports them.

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
3. **Shrink-as-needed runs through the balloon's reporting queue.**
   Once the guest's free-page-reporting framework hands a free run
   back to the VMM, the balloon backend `madvise`s it out of host
   RSS. Without the balloon enabled (older kernels, or
   `CONFIG_VIRTIO_BALLOON=n`) RSS only falls when the VMM exits.
   The numbers in this table predate the balloon being wired up;
   re-running with reporting enabled shows the post-`drop_caches`
   row drift back toward the post-boot 302 MiB.

KVM behaves the same way; the `MAP_ANONYMOUS` semantics are
identical and the `KVM_SET_USER_MEMORY_REGION` call is even more
clearly a translation-only operation than HVF's.

## Why "memory grows and shrinks as needed" needs a balloon

The natural read of "shrink as needed" is that idle guests should
return memory to the host. The host kernel cannot do this on its
own: the anonymous page is _resident_, owned by the VMM process,
and no Linux/Darwin reclaim heuristic knows that the guest kernel
has marked the corresponding guest physical page as free.

The standard fix is a **virtio-balloon** device. machinen advertises
the **free-page-reporting** variant (Linux 5.7+) — the guest
proactively reports free runs over a dedicated virtqueue, no
inflate/deflate ping-pong:

1. Guest driver posts free runs as `{ guest_phys, len }` descriptors.
2. The VMM coalesces adjacent ranges and calls `madvise` on each:
   - **Linux:** `madvise(addr, len, MADV_DONTNEED)`. Kernel drops the
     physical pages immediately; next guest access zero-faults a
     fresh page through the same lazy-commit path as boot.
   - **Darwin:** `madvise(addr, len, MADV_FREE_REUSABLE)`. Pages are
     marked discardable; the kernel reclaims them under memory
     pressure, and `phys_footprint` drops immediately even when
     `task_basic_info.resident_size` doesn't.

`virtio-mem` is an alternative that hot-plugs/un-plugs whole memory
blocks. Powerful, but more complex than this codebase needs.

### Why `madvise`, not `mmap MAP_FIXED`

An earlier iteration of the reclaim path used
`mmap(addr, len, PROT_READ | PROT_WRITE, MAP_FIXED | MAP_PRIVATE | MAP_ANONYMOUS)`
to atomically install a fresh zero-fill mapping over the guest range.
That worked under light load but corrupted the guest under stress
(#282 — HTTP load reproduces it as `Exec format error` on freshly
exec'd binaries while the rootdisk image stays clean).

The root cause is a primitive mismatch: `hv_vm_map` and
`KVM_SET_USER_MEMORY_REGION` register a host-VA → guest-PA
relationship and expect the host VA to be stable. `mmap MAP_FIXED`
tears down the existing VMA and installs a fresh one at the same
VA. Whether the kernel invalidates stage-2 in lockstep with that
teardown is implementation-defined; under load the hypervisor's
view and the host kernel's view can desynchronise long enough that
the guest reads zeros from a page it still considers in use.

`madvise` doesn't fight this invariant. It releases the physical
pages backing the range without touching the VMA — the host VA is
still valid, the hypervisor's stage-2 entry still points at it, and
the next guest access faults through the same lazy-commit path it
always did. KVM's API docs say so directly: use
`madvise(MADV_DONTNEED)`, not `mmap MAP_FIXED`.

### Darwin RSS reporting note

`MADV_FREE_REUSABLE` excludes the affected pages from
`phys_footprint` immediately, but they stay counted in
`task_basic_info.resident_size` until the kernel actually reclaims
them. So `ps -o rss=` doesn't reflect balloon reclaim on Darwin even
when reclaim is working. To keep `vm.memoryStats().hostRssBytes`
honest, the VMM samples its own `phys_footprint` via
`proc_pid_rusage(getpid(), RUSAGE_INFO_V4, ...)` once every ~500 ms
and writes it into the shared `MACHINEN_STATS_FILE`. The host
runtime prefers that value over `ps -o rss=`. See
`packages/microvm/src/stats.zig` and
`packages/runtime/src/proc-rss.ts`.

## Restore: eager by default, lazy as opt-in

Restore has two paths that load the workload's CRIU image into the
guest:

- **Eager (default).** The runtime packs `imgDir/` into a tar
  attached as `/dev/vdb`. The guest's `/sbin/machinen-restore`
  untars into tmpfs and CRIU loads every page up front. Simple,
  robust, works under `--detach`.
- **Lazy (`--lazy` / `restore({ lazy: true })`).** The bundle is
  vsock-FUSE-mounted into the guest and `criu restore --lazy-pages`
  faults workload pages on demand (#266). Keeps host RSS
  proportional to the touched set on big idle heaps, but:
  1. It can't compose with `--detach` today — the host-side FUSE
     server lives in the runtime supervisor, and detach exits
     that. The runtime forces `lazy: false` when `--detach` is set
     to keep that combination usable. A standalone FUSE helper
     that survives supervisor exit is on the roadmap (#150 phase 3).
  2. The promised RSS savings haven't been measurably reproduced on
     Darwin/HVF for small-heap workloads (tracked separately).

The default flipped to eager because the lazy savings only matter
when the workload's anon is large enough to be worth deferring, and
failure mode (1) bites anything else. Pass `--lazy` when you have a

> GiB heap that the restored process will only sample.

### Free-page-reporting under lazy restore (#290)

There used to be a third strike against `lazy`: with
`VIRTIO_BALLOON_F_REPORTING` enabled, the guest kernel's
`page_reporting` workqueue would re-report the same physical region
every 2-second cycle, so `bytes_reported` climbed to many times
the VM's RAM ceiling and `phys_footprint` crept up indefinitely.
The original theory ("the reporting kthread reads pages and that
read fires UFFD") turned out to be wrong on inspection — CRIU's
`lazy-pages.log` stayed silent in steady state, and the reporting
kthread doesn't actually read page contents.

The real culprit was in `mm/page_alloc.c::__free_one_page`. When the
buddy allocator merges a freed page with an adjacent free buddy,
`__del_page_from_free_list` clears the buddy's `Reported` flag
(correct for genuine allocations), and the merged block lands on
the higher-order free list with no `Reported` flag at all — so
the next reporting cycle picks it up as "unreported" and reports
the same physical region again. On a typical workload this barely
shows because freed pages rarely have a Reported buddy. After a
CRIU lazy restore the workload's PE_LAZY anon range stays as huge
contiguous free runs, so almost every free triggers a merge with a
Reported buddy and almost every cycle re-reports.

Fixed by an in-tree kernel patch that refuses to merge with a
Reported buddy:
`packages/microvm/patches/kernel/0001-mm-page-reporting-skip-merge-with-reported-buddy.patch`.
The cycle now terminates after a single warm-up sweep (~22 s on a
1.5 GiB VM with a 128 MiB workload in the reproducer), and
`phys_footprint` stays flat afterwards. Reporting is unconditionally
on; there is no env-var override.

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
- Be aware of the high-water mark: long-lived VMs that briefly spike
  to N MiB will hold that RSS until the guest frees those pages and
  the balloon reports them. With `reclaim: "auto"`, the VMM can return
  reported free pages to the host; without guest cooperation, the spike
  remains charged until exit.
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
   shrink), same answer (virtio-balloon's free-page-reporting variant).
   They did not pursue virtio-mem.
2. **Firecracker's balloon driver is conservative on purpose.** They batch
   `MADV_DONTNEED` and rate-limit it — naive "drop everything immediately"
   is measurably bad because cold-start latency on the _next_ page touch
   spikes. machinen coalesces adjacent runs in a single chain (#263
   phase D); cross-chain rate-limiting is the next step (phase E).

A bonus observation: Apple's `Virtualization.framework` not exposing
balloon is the reason Lima-on-vz and UTM-on-vz feel memory-hungry compared
to their QEMU equivalents. machinen uses HVF directly (not the
higher-level framework) so it _can_ implement balloon — framework-bound
projects can't.

## Summary

- **Grow-as-needed** up to the configured ceiling works on both HVF
  and KVM through the standard lazy-commit anonymous mapping. No
  code change required.
- **Shrink-as-needed** runs through the virtio-balloon
  free-page-reporting queue, with `madvise` as the host-side reclaim
  primitive (`MADV_DONTNEED` on Linux, `MADV_FREE_REUSABLE` on
  Darwin). Requires the guest kernel's `CONFIG_VIRTIO_BALLOON`.
- **`vm.memoryStats().hostRssBytes`** reads `phys_footprint` from
  the VMM's stats file on Darwin (sampled every ~500 ms) and
  `/proc/<pid>/status:VmRSS` on Linux, so reclaim is observable on
  both backends.
