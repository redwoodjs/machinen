# Target VM synthetic continuation proof

Issue #585 moves the synthetic continuation proof boundary from a host process
trampoline toward an amd64 target VM.

The helper script boots an amd64 Machinen VM on a Linux/amd64 host, copies the
[target guest restore loader](./target-guest-restore-loader.md), native resume
trampoline, a generated target-native code blob, and a restore descriptor into
the guest, then executes the loader inside the guest. The loader validates the
descriptor before the trampoline maps the supplied amd64 bytes, installs a
synthetic stack and optional modeled fd recipe, and jumps to the target bytes.

```bash
MACHINEN_TARGET_VM_IMAGE=/path/to/rootfs-debian-amd64.tar.gz \
  pnpm native-target-vm-synthetic-continuation -- \
  --code-file /path/to/target-synthetic-ppoll.bin \
  --synthetic-empty-eventfd 3 \
  --json
```

Success still means target-native generated amd64 bytes completed inside the
amd64 guest. The script reports:

- `targetVmAttempted: true` after an amd64 VM was booted and the guest command
  ran;
- `targetGuestLoaderUsed: true` after the in-guest descriptor loader is injected;
- `migrationCompleted: true` only when the in-guest loader/trampoline exits `0`;
- `sourceTextReusedAsTargetCode: false`;
- `sourceIsaEmulationUsed: false`;
- `sidecarRuntimeUsed: false`.

On non-Linux/amd64 hosts, without a code file, or without a target rootfs image,
the proof skips with a clear reason. The follow-up target-guest restore loader
will replace this trampoline-oriented helper with a bundle-driven in-guest loader.
