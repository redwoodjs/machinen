# @machinen/microvm

## 0.6.0

### Minor Changes

- 39300fb: Default VM and persistent PTY session names to `default`, and fix persistent PTY list/reconnect/exit handling so `machinen attach` works as a tmux-like reconnectable shell by default.

## 0.5.0

### Patch Changes

- f8f84c2: Fix x64 Linux VMs booting with a fifth live mount by keeping virtio-fs IRQs valid under `noapic`.

  Surface early guest kernel panics in boot errors by including a bounded VMM stderr tail and panic/oops classification.

  Build the vmstate entropy reseed helper for the selected guest target so amd64 base assets do not receive an arm64 helper.

## 0.4.2

## 0.4.1

## 0.4.0

### Minor Changes

- 37cf5fa: Ship amd64 Linux/KVM guest support.

  The release now publishes the `@machinen/native-x64-linux` host package and amd64 base assets (`bzImage-x86_64`, `rootfs-debian-amd64.tar.gz`, and the prebaked rootfs image). On amd64 Linux hosts, the CLI/runtime select amd64 guest assets by default and same-architecture amd64 snapshot/restore uses the vmstate path.

## 0.3.4

### Patch Changes

- 710ada8: Fix HVF boots on macOS 26 Tahoe by handling trapped wait instructions and system-register accesses, including M4 debug registers that Apple's current SDK does not expose.

## 0.3.3

### Patch Changes

- Implement virtio-fs symlink resolution (`READLINK`), hardlinks (`LINK`), and executable mode changes so live mounts support `readlink`/`realpath`, pnpm-style hardlinks, and `chmod +x` scripts.

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

## 0.2.0

## 0.1.2

## 0.1.1

## 0.1.0
