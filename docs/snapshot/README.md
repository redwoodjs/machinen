# Snapshot, restore, and move

This page describes the current product surfaces only.

## VM snapshot and restore

```sh
machinen snapshot <vm> <out-dir>
machinen restore <snap-dir>
```

Use these commands to save and restore a Machinen VM snapshot. See:

- [vmstate specification](./vmstate-specification.md)
- [vmstate portability policy](./vmstate-portability.md)

Whole-VM vmstate restore is same-guest-ISA only. A vmstate bundle contains CPU,
RAM, device, and rootdisk state for one guest architecture.

## Cross-ISA movement

`machinen move` is the experimental cross-ISA process descriptor entrypoint. It
is not a general live workload migration command. Give it a running VM name or
VMM pid, then a guest PID when saving a descriptor.

```sh
machinen move scan <vm>
machinen move save <vm> <guest-pid> <bundle-dir>
machinen move save <vm> <guest-pid> <bundle-dir> --issue [--issue-repo <owner/repo>]
machinen move load <vm> <bundle-dir>
```

`move save` writes a bundle directory containing `move.json`. `move load` accepts
that same bundle directory shape and refuses file paths or partial descriptors.
Unsupported files, sockets, threads, or process contexts stay fail-closed with
typed evidence before target execution.

## Product boundary

Snapshot and restore are whole-VM operations. `move` is separate from vmstate: it
must reconstruct explicitly modeled process/resource state on the target instead
of replaying source kernel, vCPU, or device state.
