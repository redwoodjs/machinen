# @machinen/native-arm64-linux

## 0.8.8

## 0.8.7

## 0.8.6

## 0.8.5

### Patch Changes

- 356eaff: Move final writable live-mount sync into the guest lifecycle owner so fresh and restored workloads keep their original argv, terminal, stdin, signals, and exit behavior. Graceful kill and stop requests now wait for guest cleanup, with forced VMM termination retained only as a timed fallback. Ship the compiled supervisor and restore worker on every boot for older cached and custom images.

## 0.8.4

## 0.8.3

## 0.8.2

## 0.8.1

## 0.8.0

## 0.7.2

## 0.7.1

## 0.7.0

### Patch Changes

- 90f20ca: Ship the runtime's native host tools with the platform packages: `machinen-runtime-helper`, `machinen-pdeathsig`, `machinen-pty`, and `machinen-winsize`. The release build now stages Darwin tools from macOS and Linux tools from Linux so published packages contain the right binaries for each host.

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.2

## 0.4.1

## 0.4.0

### Minor Changes

- bd30262: Add opt-in nested virtualization for arm64 hosts.

  `boot({ nested: true })` and `machinen boot --nested` now ask the VMM to expose EL2 to the guest. Linux/KVM uses `KVM_CAP_ARM_EL2` and `KVM_ARM_VCPU_HAS_EL2`; macOS uses Hypervisor.framework's EL2 VM config when available. The guest kernel config now builds KVM in so `/dev/kvm` can appear inside nested-capable guests, masks SVE/SME features that HVF cannot virtualize at EL2, and uses a nested-safe poweroff marker when PSCI terminates inside the L1 guest. Provider-level snapshots of nested-enabled VMs are refused until EL2 vmstate capture is fully audited. Docs now include a Firecracker guide, plus an example that boots an aarch64 Firecracker L2 inside machinen.

### Patch Changes

- a223148: Fix virtio-fs live mounts on Linux/KVM.

  Linux arm64 now reads host file metadata with the right `stat` layout, so `--mount-live` no longer crashes the VMM during `GETATTR`. Appends through a live mount now honor the guest's write offset instead of duplicating bytes on Linux hosts.

## 0.3.4

## 0.3.3

### Patch Changes

- Complete the next live-mount compatibility slice by implementing virtio-fs `READLINK` and `LINK`, applying executable mode changes from `SETATTR`, and adding smoke coverage for symlink resolution, hardlinks, and `chmod +x` execution.

## 0.3.2

### Patch Changes

- Fix virtio-fs `rmdir` on non-empty directories to return `ENOTEMPTY` instead of surfacing as guest `EIO`, and add directory-removal coverage for live mounts.

## 0.3.1

### Patch Changes

- Fix virtio-fs live mounts writing to existing files.

  Writable opens now keep a read-capable host fd so Linux writeback-cache READ-fill requests on `O_WRONLY` handles do not surface as `EIO`. `SETATTR` now applies size truncation, and `RENAME` is implemented so `mv`/overwrite workflows work inside `--mount-live`.

## 0.3.0

### Minor Changes

- Ship the virtio-fs live-mount transport and the vmstate snapshot pipeline.

  This release moves live mounts fully into the VMM via multi-slot virtio-fs, removes the old FUSE-over-vsock transport, consolidates the native host tools into the `@machinen/native-arm64-*` packages, and makes vmstate snapshots/restores the default path with asynchronous writes and faster restore handling.
