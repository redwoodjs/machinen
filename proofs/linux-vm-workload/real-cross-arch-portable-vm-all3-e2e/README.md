# Real cross-arch portable VM all-3 E2E

Status: `verified`

Scope: `real-cross-arch-portable-vm-filesystem-service-sqlite-v1`

This proof captures and restores all three requested portable VM workload rows together: filesystem, selected service, and clean SQLite. The source side runs on amd64 Linux via Docker and emits a portable bundle. The target side boots a arm64 Machinen VM, mounts the bundle, reconstructs the file tree, starts a target-native service, installs target-native SQLite tooling when needed, restores the clean SQLite DB, and runs target-side verifiers.

This does **not** claim arbitrary VM restore, raw VM/vCPU replay, source ISA emulation, or metadata-only success.

## Result

- Source architecture: amd64
- Target architecture: arm64
- Cross architecture: true
- Filesystem verified: true
- Service verified: true
- SQLite verified: true
- Target VM booted: true
- Target verifier passed: true

## Retained artifacts

- `retained/boot.stderr.txt`
- `retained/boot.stdout.json`
- `retained/build.stderr.txt`
- `retained/build.stdout.txt`
- `retained/bundle/filesystem-manifest.json`
- `retained/bundle/filesystem-sha256.txt`
- `retained/bundle/filesystem/root/etc/machinen/message.txt`
- `retained/bundle/filesystem/root/var/lib/machinen/data/numbers.txt`
- `retained/bundle/portable-vm-all3-manifest.json`
- `retained/bundle/service-expected-response.txt`
- `retained/bundle/service-manifest.json`
- `retained/bundle/sqlite-dump.sql`
- `retained/bundle/sqlite-expected.env`
- `retained/bundle/sqlite-logical.json`
- `retained/bundle/target-restore.sh`
- `retained/bundle/target-verify.sh`
- `retained/docker-source.stderr.txt`
- `retained/docker-source.stdout.txt`
- `retained/source-capture-transcript.json`
- `retained/source-capture.py`
- `retained/target-restore.stderr.txt`
- `retained/target-restore.stdout.json`
- `retained/target-verify.stderr.txt`
- `retained/target-verify.stdout.json`
- `retained/real-cross-arch-portable-vm-all3-e2e-report.json`
