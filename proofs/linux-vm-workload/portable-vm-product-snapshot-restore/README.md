# Portable VM product snapshot/restore E2E

Status: `verified`

Scope: `portable-vm-all3-product-snapshot-restore-v1`

This proof promotes the all-three portable VM path into product commands:

`machinen snapshot <vm> --portable --out <bundle>`
`machinen restore <bundle> --json`

The snapshot command detects source architecture from inside the source VM. The restore command detects target architecture from the target VM/host policy; no `--source-arch` or `--target-arch` flag is required. This retained run validates the product command path on the local target architecture. Cross-architecture product execution is still gated on an available opposite-architecture Machinen target host; the retained cross-architecture workload proof remains in `real-cross-arch-portable-vm-all3-e2e`.

## Result

- Source architecture detected: true
- Target architecture detected: true
- Source architecture: arm64
- Target architecture: arm64
- Cross architecture in this retained run: false
- Snapshot completed: true
- Restore completed: true
- Filesystem verified: true
- Service verified: true
- SQLite verified: true

## Retained artifacts

- `retained/snapshot.json`
- `retained/restore.json`
- `retained/portable-vm.snap/portable-vm-snapshot-summary.json`
- `retained/portable-vm.snap/portable-vm-product-restore-summary.json`
- `retained/portable-vm.snap/source-architecture.txt`
- `retained/portable-vm.snap/portable-vm-all3-manifest.json`
- `retained/portable-vm-product-snapshot-restore-e2e-report.json`
