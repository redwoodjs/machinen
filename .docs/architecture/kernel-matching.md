# Kernel Compatibility

CRIU checkpoints capture process state using kernel-level structures. A common
misconception is that CRIU requires the exact same kernel version for
checkpoint and restore — it does not. CRIU checks for **feature and ABI
compatibility**, not version strings.

## What CRIU Actually Checks

- **Kernel config**: `CONFIG_CHECKPOINT_RESTORE=y`, `CONFIG_NAMESPACES=y`, etc.
- **CPU features**: Target CPU must support all features present at checkpoint
  time (relaxable with `--cpu-cap=none`)
- **ABI compatibility**: Syscall numbers, `/proc` format, structure layouts
- **Feature availability**: If the checkpointed process used specific kernel
  features (namespaces, cgroups), the restore kernel must support them

## What Works

- **Same architecture, different kernel versions**: Linux maintains strong
  backward ABI compatibility. Restoring on a **newer** kernel usually works.
- **Same distro kernel line**: Very reliable (e.g., Ubuntu 6.8.x → 6.8.y)
- **Cross minor versions**: Generally works if kernel config options match

## Local (OrbStack) vs Remote (Hetzner)

- Local: OrbStack runs a custom kernel (e.g., `6.17.8-orbstack`) on arm64
- Remote: Ubuntu 24.04 on Hetzner cax11 (arm64) with stock kernel `6.8.x`

Both are arm64. Ubuntu 24.04 ships with `CONFIG_CHECKPOINT_RESTORE=y`. The
stock kernel should support CRIU restore without modification. If issues
arise, check:

1. `criu check` on the remote to verify CRIU support
2. Docker logs for the specific CRIU error (`journalctl` or `dockerd` logs)
3. `--cpu-cap=none` to relax CPU feature checks
