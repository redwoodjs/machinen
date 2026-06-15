# Memory in machinen

Machinen memory has two different numbers that are easy to mix up:

1. **Capacity ceiling** — how much RAM the guest is allowed to use.
2. **Host footprint** — how much memory the VM is actually costing the host right now.

The important model is:

> Give the guest room to grow, but only pay host memory for pages the guest really touches and still needs.

## The API

For new code, describe memory as a resource goal:

```ts
import { boot } from "@machinen/runtime";

const vm = await boot({
  resources: {
    memory: {
      maxMib: 4096,
      reclaim: "auto",
    },
  },
});
```

- `maxMib` is the guest-visible RAM ceiling.
- `reclaim: "auto"` lets the guest report free pages so machinen can return them to the host.

The older shorthand still works:

```ts
await boot({ memory: 4096 });
```

Treat `memory` as a compatibility/debug alias for `resources.memory.maxMib`.

## Ceiling is not reservation

If you boot with `maxMib: 4096`, the guest sees roughly a 4 GiB machine.
That does **not** mean the host immediately loses 4 GiB of RAM.

Machinen maps guest RAM lazily. At boot, the host creates a large address range, but physical host pages are committed only when the guest writes to them.

So a VM can have:

```txt
ceiling:       4096 MiB
host footprint: ~150 MiB after boot
```

Those numbers are normal together. The first number is capacity. The second number is current cost.

## Why the boot footprint is not tiny

A fresh VM is not empty. Even before your app runs, memory is used by:

- the guest Linux kernel,
- kernel metadata for the configured RAM ceiling,
- page tables,
- virtio devices,
- early userspace and the exec agent,
- root filesystem setup and caches,
- the host VMM process itself.

In recent local measurements, a 4 GiB-ceiling Linux VM started around **150 MiB** of host footprint after boot/reclaim. That is much smaller than 4 GiB, but it is not single-digit MiB.

## Grow on touch

Host footprint grows when the guest touches memory.

Example shape:

```txt
boot:             ~153 MiB host footprint
write 1 GiB file: ~1200 MiB host footprint
```

The guest wrote pages, so the host had to back them with real memory.

## Shrink through balloon reporting

The host cannot automatically know which guest pages are free. The guest kernel has to tell machinen.

Machinen uses virtio-balloon free-page reporting:

1. Your workload frees memory or deletes files.
2. The guest kernel marks pages free.
3. The balloon driver reports free page ranges to the VMM.
4. The VMM calls `madvise` so the host can drop those pages.

Example shape:

```txt
boot:               ~153 MiB
post allocation:   ~1200 MiB
post free/reclaim:  ~164 MiB
```

Temporary spikes should not become the long-term footprint once the guest frees the memory and reporting runs.

## Reading memory stats

Use `vm.memoryStats()`:

```ts
const stats = await vm.memoryStats();

console.log({
  ceilingMib: stats.ceilingMib,
  hostMib: stats.hostRssBytes == null ? null : stats.hostRssBytes / 1024 / 1024,
  reclaimedMib: stats.balloonReclaimedBytes / 1024 / 1024,
});
```

Fields to care about:

- `ceilingMib` — configured guest capacity.
- `hostRssBytes` — current host footprint.
- `balloonReclaimedBytes` — bytes returned through balloon reporting.

`balloonInflatedBytes` is still present as an older alias for `balloonReclaimedBytes`.

You can also inspect running VMs with:

```sh
machinen ls --json
```

## Choosing a memory value

Use a ceiling that is comfortably above your workload's expected peak.

For example:

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

This means:

- the guest can grow up to about 4 GiB,
- the host does not reserve 4 GiB up front,
- memory touched during a spike can be reclaimed after the guest frees it.

Do not set the ceiling infinitely high. Larger ceilings still add some guest kernel metadata and increase the possible high-water mark.

## Platform caveat: macOS RSS

On Linux, host footprint is read from `/proc/<pid>/status:VmRSS`.

On macOS, `ps rss` can stay high after reclaim because `MADV_FREE_REUSABLE` pages remain in the resident-size accounting until the kernel is under pressure. Machinen therefore prefers the VMM's sampled `phys_footprint`, which drops when pages become reusable.

So for machinen, trust `vm.memoryStats().hostRssBytes` over raw `ps` output on macOS.

## Mental model

Think of machinen memory like a sparse file:

- The file can have a large maximum size.
- Empty regions cost almost nothing.
- Written regions cost real storage.
- Deleted/free regions can be punched out and returned.

For VMs:

- `maxMib` is the maximum size.
- touched guest pages are the written regions.
- balloon-reported pages are the punched-out regions.
