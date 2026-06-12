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

## Cross-ISA movement

`machinen move` is the only cross-ISA product entrypoint. Give it a running VM name or VMM pid, then a guest PID when saving a descriptor.

```sh
machinen move scan <vm>
machinen move save <vm> <guest-pid> <out-dir>
machinen move save <vm> <guest-pid> <out-dir> --issue [--issue-repo <owner/repo>]
machinen move load <vm> <bundle-dir>
```

`move save` writes a bundle directory whose `move.json` records the target VM's guest PID graph and attaches a procfs-backed resource plan for the selected PID. The resource plan is captured by `/sbin/machinen-move-capture` when the guest image provides it, with a shell fallback for older dev rootfs images. It reuses the native fd-table/resource translator, so regular files and proof-backed socket recipes can graduate while unsupported fds, PTYs, and sockets stay fail-closed with typed evidence. External ICMP ping/raw-ICMP descriptors use the `external-*-v1:no-inflight-target-egress` contract: packet queues must be empty and future packets use the target VM's own route/NAT identity.

The generic direction is resource-driven support: move a selected binary only when its observed resource graph is fully understood, and refuse exact unsupported resource classes. This is not arbitrary process or any-binary movement. See [Generic resource graph move envelope](./generic-resource-graph-move.md) for the contract and inventory, [Generic resource graph migration wave 1](./generic-resource-graph-migration-wave1.md) for selected bespoke-to-generic-equivalent migration boundaries, [Generic resource graph graduation frontier](./generic-resource-graph-frontier.md) for unsupported resource-class follow-up contracts, [Generic pipes/stdio graduation](./generic-pipes-stdio-graduation.md) for the pipe/stdio contract, and the generic move envelope's regular-file cursor rows for the current read-only fd cursor boundary.

PostgreSQL support is an explicit narrow `machinen move` envelope, not generic process teleportation. See [PostgreSQL move envelope ladder](./postgres-move-envelope.md) for the descriptor, target-native loader, target `psql SELECT 1` evidence, and refusal boundaries.

## Product boundary

Snapshot and restore are whole-VM operations. Runtime-specific, clean-service, portable descriptor, and proof-only routes are not part of the public snapshot/restore workflow.

Proofs, checked summaries, and historical design notes are kept in [`../../research/snapshot/`](../../research/snapshot/) so this directory stays product-focused.
