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

`machinen move` is the only cross-ISA product entrypoint.

```sh
machinen move scan
machinen move save <pid> <out>
machinen move save <pid> <out> --issue [--issue-repo <owner/repo>]
machinen move load <descriptor>
```

`move` records the PID graph and refuses state classes that do not have a target-native reconstruction path.

## Product boundary

Snapshot and restore are whole-VM operations. Runtime-specific, clean-service, portable descriptor, and proof-only routes are not part of the public snapshot/restore workflow.

Proofs, checked summaries, and historical design notes are kept in [`../../research/snapshot/`](../../research/snapshot/) so this directory stays product-focused.
