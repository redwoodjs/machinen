# Snapshot documentation

This page documents the current product state only.

## Current product surfaces

- `machinen snapshot <vm> <out-dir>` / `machinen restore <snap-dir>`: VM snapshot and restore.
- `machinen move scan`: scan PID graph state classes for cross-ISA movement.
- `machinen move save <pid> <out>`: write a move descriptor or a fail-closed refusal descriptor.
- `machinen move save <pid> <out> --issue [--issue-repo <owner/repo>]`: include redacted refusal evidence for filing an improvement issue.
- `machinen move load <descriptor>`: validate a move descriptor and refuse unproven state classes.
- `machinen support --json`: inspect the product claim registry.

## Current cross-ISA rule

`machinen move` is the only cross-ISA product entrypoint. It owns the PID graph,
records translated state classes, and refuses unproven state classes with
actionable evidence.

Legacy Level 0-4 cross-ISA product routes are not current product support.

## Current references

- [Product claim registry](./product-claim-registry.md)
- [Clean service product snapshot/restore](./clean-service-product-snapshot-restore.md)
- [Node product snapshot/restore](./node-product-snapshot-restore.md)
