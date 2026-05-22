# Portable machine VM restore proof

Issue #589 wires the ladder pieces into one product-shaped proof profile:

```text
arm64 source context -> portable machine snapshot bundle -> amd64 target VM -> target-native completion
```

The proof harness requires a validated portable machine snapshot bundle and target
continuation bytes stored inside that bundle. It then boots the amd64 target VM
through the target-guest loader path. A run is successful only when the target VM
reports target-native completion with:

- `migrationCompleted: true`
- `sourceTextReusedAsTargetCode: false`
- `sourceIsaEmulationUsed: false`
- `sidecarRuntimeUsed: false`

Example:

```bash
MACHINEN_TARGET_VM_IMAGE=/path/to/rootfs-amd64.tar.gz \
  pnpm portable-machine-vm-restore-proof -- \
  --bundle-dir /tmp/portable-machine \
  --target-code-file /tmp/portable-machine/target/continuation.bin \
  --synthetic-empty-eventfd 3 \
  --json
```

The harness skips clearly when no amd64 VM image is available. CI should run this
profile whenever portable machine bundle layout, target guest loader behavior,
restore descriptor handling, or target-native continuation execution changes.
Raw cross-ISA `.vmstate` replay remains a refusal, not a success path.
