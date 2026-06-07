# Node Level 5 cross-architecture release corpus harness

Proofs 501–560 exercise the retained Node Level 5 product snapshot format across both recorded directions:

- `arm64-to-amd64`
- `amd64-to-arm64`

These are harness proofs for release gating. They do not raise product support claims on their own. The product UX remains:

```sh
machinen snapshot <vm-name> --out ./node-snapshot
machinen restore ./node-snapshot
```

The release corpus checks that target identity, detector, capture, artifact, and restore materialization evidence stay linked and verifiable. It also keeps the unsafe boundaries explicit: no raw CPU restore, no source ISA emulation, no metadata-only success, and no arbitrary process restore claim.

Claims remain:

- Node product support: 80%.
- Broad Node product support: 20%.
- Arbitrary process cross-architecture restore: 0%.
