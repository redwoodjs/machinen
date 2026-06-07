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

## Product support discovery

```sh
machinen support --json
```

Use this as the source of truth for supported, refused, deprecated, and proof-only rows. See [Product claim registry](./product-claim-registry.md).

## Product subsets

- [Clean service snapshot/restore](./clean-service-product-snapshot-restore.md)
- [Node snapshot/restore](./node-product-snapshot-restore.md)

Proofs, checked summaries, and historical design notes are kept in [`../../research/snapshot/`](../../research/snapshot/) so this directory stays product-focused.
