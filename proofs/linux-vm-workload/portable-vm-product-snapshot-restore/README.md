# Portable VM product snapshot/restore E2E

Status: `verified`

Scope: `portable-vm-all3-product-snapshot-restore-v1`

This proof promotes the all-three portable VM path into product commands:

`machinen snapshot <vm> --portable --out <bundle>`
`machinen restore <bundle> --json`

The snapshot command detects source architecture from inside the source VM through the guest portable VM inventory agent. It emits `portable-vm-raw-inventory.json` and `portable-vm-manifest-plan.json`. The restore command detects target architecture from the target VM/host policy, consumes the VM Portability Plan before booting the target VM, and requires no `--source-arch` or `--target-arch` flag. This retained proof includes a local plan-consuming run and a real opposite-architecture `arm64→amd64` product restore on `root@192.168.0.8`. The selected all-three workload is verified without claiming arbitrary VM restore.

## Result

- Source architecture detected: true
- Target architecture detected: true
- Guest inventory agent used: true
- Portable VM Manifest emitted: true
- VM Portability Plan emitted and consumed: true
- Source architecture: arm64
- Target architecture: amd64
- Cross architecture in the retained remote product run: true
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
- `retained/portable-vm.snap/portable-vm-raw-inventory.json`
- `retained/portable-vm.snap/portable-vm-manifest-plan.json`
- `retained/arm64-to-amd64/restore.json`
- `retained/arm64-to-amd64/restore.err`
- `retained/arm64-to-amd64/build-kernel-x86_64.log`
- `retained/arm64-to-amd64/remote-asset-audit.txt`
- `retained/portable-vm-product-snapshot-restore-e2e-report.json`
