# Node Level 5 product snapshot/restore surface

Node Level 5 support now uses the product-shaped surface first:

```sh
machinen snapshot node \
  --out ./node-snapshot

machinen restore ./node-snapshot
```

This path does not require an experimental Node Level 5 flag. `snapshot node` detects the current app directory before capture. It accepts the supported idle HTTP app shape and refuses unsupported Node state before writing a snapshot.

The detector report is retained inside the snapshot and verified during restore. The path still keeps the support boundary narrow:

- Node product support: 80%.
- Broad Node product support: 20%.
- Arbitrary process cross-architecture restore: 0%.
- Raw CPU restore: not supported.
- Source ISA emulation: not supported.

The diagnostic `machinen node-level5 ...` commands remain useful for release gates and support triage, but they are no longer the primary product shape. The product direction is snapshot first, restore second, with retained detector evidence and artifact evidence checked behind the scenes.
