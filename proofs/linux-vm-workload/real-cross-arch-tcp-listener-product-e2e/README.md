# Real cross-arch TCP listener product E2E

Status: `verified`

Scope: `real-cross-arch-tcp-listener-product-e2e-v1`

This is a real product-command cross-architecture snapshot/restore proof for the selected TCP listener workload. The source side runs an actual amd64 Linux socket workload in Docker, `machinen capture tcp-listener` writes a portable bundle, and `machinen restore <bundle> --target-arch arm64` boots a target-native Machinen VM and verifies the restored listener.

This does **not** claim arbitrary VM restore, raw VM/vCPU replay, source ISA emulation, or metadata-only success.

## Result

- Source architecture: amd64
- Target architecture: arm64
- Cross architecture: true
- Capture completed: true
- Restore completed: true
- Target VM booted: true
- Target verifier passed: true
- Target log: `MACHINEN_TCP_LISTENER_RESTORED family=inet protocol=tcp bind=127.0.0.1:18080 backlog=8 acceptQueue=empty reuseaddr=true fd=6`

## Product commands

`machinen capture tcp-listener; machinen restore <bundle> --target-arch <target> --json`

## Retained artifacts

- `retained/source-listener.py`
- `retained/source-verifier.txt`
- `retained/docker-source.stderr.txt`
- `retained/capture.stdout.json`
- `retained/capture.stderr.txt`
- `retained/restore.stdout.json`
- `retained/restore.stderr.txt`
- `retained/target-listener-log.txt`
- `retained/bundle/portable-tcp-listener.json`
- `retained/bundle/portable-tcp-listener-restore-summary.json`
- `retained/bundle/portable-tcp-listener-target-vm-restore-summary.json`
- `retained/real-cross-arch-tcp-listener-product-e2e-report.json`
