# Snapshot and restore

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

## Cross-ISA boundary

Machinen does not expose a public cross-ISA process-move command. Raw vmstate
bundles replay source kernel, vCPU, device, and rootdisk state, so they are not a
cross-ISA bridge. A cross-ISA restore attempt fails closed instead of replaying
state on an incompatible guest architecture.

## Product boundary

Snapshot and restore are whole-VM operations. Runtime-specific and experimental
descriptor routes are not part of the public snapshot/restore workflow.
