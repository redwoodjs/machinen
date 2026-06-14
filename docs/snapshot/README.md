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

`machinen move` is the cross-ISA product entrypoint. Give it a running VM name
or VMM pid, then a guest PID when saving a descriptor.

```sh
machinen move scan <vm>
machinen move save <vm> <guest-pid> <out-dir>
machinen move save <vm> <guest-pid> <out-dir> --issue [--issue-repo <owner/repo>]
machinen move load <vm> <bundle-dir>
```

`move save` writes a bundle directory whose `move.json` records the target VM's
guest PID graph and attaches a procfs-backed resource plan for the selected PID.
The resource plan is captured by `/sbin/machinen-move-capture` when the guest
image provides it, with a shell fallback for older dev rootfs images. It reuses
the native fd-table/resource translator, so regular files and explicit socket
recipes can graduate while unsupported fds, PTYs, and sockets stay fail-closed
with typed evidence. External ICMP ping/raw-ICMP descriptors use the
`external-*-v1:no-inflight-target-egress` contract: packet queues must be empty
and future packets use the target VM's own route/NAT identity.

## Product boundary

Snapshot and restore are whole-VM operations. Runtime-specific and
experimental descriptor routes are not part of the public snapshot/restore
workflow.
