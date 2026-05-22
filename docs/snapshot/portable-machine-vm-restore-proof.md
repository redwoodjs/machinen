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

## Smoke profile

Issue #593 adds a named smoke wrapper:

```bash
PORTABLE_MACHINE_TARGET_VM_IMAGE=/path/to/rootfs-amd64.tar.gz \
  pnpm --silent smoke-portable-machine-restore -- --json
```

The smoke profile creates a narrow arm64 native-process bundle, wraps it in a
portable machine snapshot, stages target-native amd64 `exit(0)` continuation
bytes inside the bundle, and runs the portable machine VM restore proof. It
reports timing for:

1. preflight / optional remote reachability gates;
2. arm64 source capture bundle creation;
3. portable bundle validation and target-byte staging;
4. bundle transfer (currently local, shaped for future remote copy timing);
5. target VM boot/restore and completion.

Set `PORTABLE_MACHINE_SMOKE_REQUIRE_REMOTES=1` to require the default remote
reachability checks (`PORTABLE_ARM64_SSH`, default `friend@100.126.46.90`, and
`PORTABLE_AMD64_SSH`, default `root@192.168.0.8`). Missing remotes, a missing
`PORTABLE_MACHINE_TARGET_VM_IMAGE` / `MACHINEN_TARGET_VM_IMAGE`, or a non-Linux
amd64 target host produce a clear skip with timing data. Failures preserve the
work directory, bundle, target logs, and generated summary; use `--keep` to keep
artifacts after successful or skipped runs as well.

Run this named smoke when touching portable machine bundle layout, target-guest
loader descriptors, target VM restore wiring, target continuation execution, or
other VM-level portable cross-ISA restore behavior. Full `pnpm smoke-tests`
remains the broader VM lifecycle suite.
