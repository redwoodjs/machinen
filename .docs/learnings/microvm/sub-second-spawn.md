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
