# #50 — where the spawn-from-snapshot time actually goes

Target: spawn → first byte from the restored workload in ≤ 1 s on
M-series Mac.

## Baseline (before this work)

From the M2 comment on #50, measured with
`packages/runtime/src/__tests__/snapshot-latency.test.ts`:

```
{ "spawnToRestoreOkMs": 9598 }
```

9.6 seconds, cold. That was with the stock QEMU-style `virt.dts`
(32 virtio-mmio slots, pcie host, flash, fw-cfg, pl031 rtc, pmu,
gpio-keys, platform-bus) and the 900 MB initramfs, no kernel
cmdline tuning.

## After kernel quieting + DTS prune

| step                               | ms    | Δ from prev |
| ---------------------------------- | ----- | ----------- |
| 9.6 s comment on #50 (M2 baseline) | ~9600 | —           |
| `quiet loglevel=3` on bootargs     | ~3000 | -6.6 s      |
| 32 → 3 virtio-mmio slots + no pcie | ~2870 | -130 ms     |

Steady-state across 4 runs after the prune: 2827 / 2874 / 2868 /
2946 ms. ~2.87 s floor.

## Where the remaining ~2.87 s goes

The earlycon timestamps give us the cleanest picture. With
`MACHINEN_DEBUG=1` + this DTS prune, the bracketed numbers look
like:

```
[    0.000000] Booting Linux on physical CPU 0x0000000000
[    0.000000] Linux version 6.1.0-44-cloud-arm64 …
[    0.000405] its@8080000: unable to locate ITS domain
[    0.012212] armv8-pmu pmu: hw perfevents: failed to probe PMU!
[    X.XXXXXX] Run /init as init process     ← big gap here
  hello from userspace!
[    Y.YYYYYY] criu restore (via criu-ns …)
  restore OK
```

The gap between `[    0.012]` and `Run /init` is where the real
time lives. With `loglevel=3` we can't see it in individual
kprintks, but it tracks with three kernel phases:

1. **RAM init + initramfs unpack** — the 900 MB cpio is the biggest
   known cost. Debian's stock cloud rootfs carries lots of stuff
   we never touch (apt, udev rules, multiple kernel-module trees,
   locales, etc.).
2. **Module discovery / hotplug** — the Debian kernel auto-probes
   everything visible in the DT + buses. With a stripped DT most
   of this is already gone.
3. **Userspace module loads in `demo.sh`** — each `insmod` pays a
   few ms. Small but adds up (virtio_net, virtio_blk, vsock, etc.).

## Levers still on the table, biggest first

1. **Slim the rootfs.** `rootfs/usr` is 620 MB of a 676 MB tree.
   Top suspects that a CC-in-sandbox workload doesn't need:
   - `/usr/lib/aarch64-linux-gnu` (68 MB) — prune to the libs Node
     - CC + Python actually load.
   - `/usr/lib/modules` (67 MB, also in `/lib/modules` → mostly
     duplicated).
   - `/usr/lib/python3.11` (28 MB) if we commit to agents that
     don't script through Python.
   - `/usr/share/zoneinfo` (3.7 MB), `/usr/share/doc` (1.9 MB).
     Back-of-envelope: dropping to ~150–200 MB should cut the
     initramfs-unpack phase by 3–5×. Probably the single biggest
     win on the table.

2. **Preload the kernel modules we use.** `demo.sh` runs
   `insmod virtio virtio_ring virtio_mmio virtio_blk failover
net_failover virtio_net vsock …` every boot. Baking those into
   the initramfs /init (or into a built-in kernel config) saves
   one `find /lib/modules -name '*.ko'` scan per module and the
   sequential init work.

3. **Fork a pre-booted VMM.** The architectural win — keep one
   VMM warm past the `Run /init` point, and on spawn either `fork`
   the host process + use CoW on guest RAM, or snapshot the VCPU +
   RAM and reload in a fresh VMM. HVF doesn't give us first-class
   vcpu-state snapshot, but the components are buildable:
   `hv_vcpu_get_sys_reg` + `hv_vcpu_get_reg` over the full GP /
   SP / PC / PSTATE set, plus an mmap of guest RAM. The savings
   go straight through the kernel-boot phase — probably gets us
   into the low hundreds of ms.

4. **Smaller kernel.** The Debian cloud kernel carries drivers
   for a lot of hardware we don't have. A purpose-built arm64
   kernel config (minimal vmlinux + modules_disabled) shrinks
   what the kernel loads during init. Real work; only worth it
   after (1).

## What this commit does

Lands (1) partially and a DTS prune:

- `virt.dts`: dropped `pcie`, `pl031` (rtc), `pmu`, `flash`,
  `fw-cfg`, `platform-bus`, `gpio-keys`, `pl061` (GPIO), the GIC
  ITS, and the 29 unused virtio-mmio slots. DTB went from 7807 to
  2271 bytes. The kernel no longer spends time probing, routing
  interrupts into, or complaining about any of these.
- Original preserved at `virt.dts.bak` for reference.

Everything that was tested before still passes:
`smoke.sh spawn` 3/3, `snapshot-latency.test.ts` 1/1 reporting
~2.87 s (down from ~3 s before). No smoke regression.

## Not in this commit (scoped out)

- Rootfs slim — lives in `packages/microvm/test-fixtures/rootfs/`
  which is produced from a docker image (see
  `Dockerfile.node-criu` + the README). Needs a Dockerfile edit +
  full rebuild. Separate commit.
- VMM fork / VM snapshot — its own issue.
- Kernel rebuild — ditto.

## Addendum (2026-04-21): under a second, via two fixes that compound

Two findings, found in the same debugging session, get us to
**~540 ms** cold spawn → `restore OK` on an M-series Mac.

### Finding 1: the DTB lied about the initrd region

`virt.dts` declared `linux,initrd-end = <0xa0000000>`, reserving
**1.48 GB** for the initramfs regardless of what we actually
loaded. The Linux kernel treats `[initrd-start, initrd-end)` as a
scan window for concatenated cpio/compressed archives — it walks
the whole thing looking for another header. At ~1 GB/s of wall
clock, that's about 1.5 s of early boot per VM, spent reading
zeros.

Instrumented kernel (`loglevel=7 printk.time=1`) shows it sharply:
the delta between full-cpio and slim-cpio runs is zero until the
very first kernel print *after* unpack —
`"Freeing initrd memory: 1507328K"` — where slim is exactly 630 ms
slower. 1507328K is the full DTB-reserved region, same for both
cpios, regardless of actual initramfs size. Smaller cpio = more
trailing dead bytes = more kernel-time scanning.

Fix in `src/boot.zig`: after copying the initramfs into guest RAM,
walk the DTB in place and overwrite `linux,initrd-end` with the
real end address. Unit test added alongside (`patchDtbInitrdEnd`
against a hand-built minimal FDT).

### Finding 2: the 676 MB rootfs carries 420 MB of dead weight

Audit of the Debian rootfs used by `smoke.sh spawn`:

| What                                   | Size | Used by spawn-warmup/restore? |
| -------------------------------------- | ---- | ----------------------------- |
| `@anthropic-ai/claude-code` npm bundle | 226 MB | No — spawn uses a tiny counter.js |
| `npm` + `corepack` + `yarn`            | 20 MB | No |
| `/boot` (duplicate kernel + initrd.img) | 39 MB | No — VMM loads Image directly |
| `/usr/lib/udev`                        | 22 MB | No — we don't run udev |
| most kernel driver modules             | 40 MB | No — we load 16 specific .ko files |
| `/usr/share/{doc,man,locale,zoneinfo,…}` | 10 MB | No |
| `/var/{cache,log,lib/apt,lib/dpkg}`    | ~15 MB | No |
| `/usr/include`                         | 220 KB | No |

`test-fixtures/spawn-minimal.excludes` captures the full list.
`mkinitramfs.py --exclude-from FILE` applies it during packing.
`smoke.sh spawn` passes this flag; other smoke modes (which do
need Node + CC + full driver set) don't.

Result: the cpio shrinks **884 MB → 307 MB**. That saves ~370 ms
of VMM-side "copy initramfs into guest RAM" time.

### Together

| config                                | ms        | vs baseline |
| ------------------------------------- | --------- | ----------- |
| full cpio, DTB-reserved 1.48 GB (baseline) | 2270–2487 | — |
| slim cpio, DTB-reserved 1.48 GB       | 2806–3013 | **+500 ms** (worse!) |
| full cpio, dynamic initrd-end         | 1173–1231 | -1100 ms |
| slim cpio, dynamic initrd-end         | **530–582** | **-1750 ms** |

The slim-only case was counter-intuitively slower until the
initrd-end bug was fixed — smaller cpio means more trailing dead
bytes in the DTB-declared window, so the kernel's post-unpack
scan got *longer* proportionally. The two fixes compound: slim
shaves VMM-side memcpy, dynamic initrd-end shaves kernel-side
scan.

### Where the ~540 ms now lives (slim + dynamic)

From `printk.time=1`:

```
[    0.000]  Booting Linux
[    0.329]  Freeing initrd memory: 409600K     (kernel unpack done)
[    0.383]  Run /init as init process
... machinen /init mounts + console wait + demo.sh
[    ~0.5]  === mount /dev/vda ===
[    ~0.55] === criu restore ===
[    ~0.6]  restore OK
```

Remaining levers, in order of size:
- **VMM spin-up + kernel-to-/init (~380 ms).** The kernel still
  does a fair amount of init before /init runs. Pre-booted VMM
  fork is the big hammer here.
- **/init + spawn-restore.sh setup (~100 ms).** Mounts, module
  loads (insmod ×16). Could fold into /init.
- **criu-ns restore itself (~60 ms).** Already pretty tight.
