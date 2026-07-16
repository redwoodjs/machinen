# @machinen/native-x64-linux

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

### Patch Changes

- f8f84c2: Fix x64 Linux VMs booting with a fifth live mount by keeping virtio-fs IRQs valid under `noapic`.

  Surface early guest kernel panics in boot errors by including a bounded VMM stderr tail and panic/oops classification.

  Build the vmstate entropy reseed helper for the selected guest target so amd64 base assets do not receive an arm64 helper.

## 0.4.2

## 0.4.1

### Patch Changes

- Publish fixed x64 Linux VMM with `noapic` in the guest kernel command line.

## 0.4.0

### Minor Changes

- 37cf5fa: Ship amd64 Linux/KVM guest support.

  The release now publishes the `@machinen/native-x64-linux` host package and amd64 base assets (`bzImage-x86_64`, `rootfs-debian-amd64.tar.gz`, and the prebaked rootfs image). On amd64 Linux hosts, the CLI/runtime select amd64 guest assets by default and same-architecture amd64 snapshot/restore uses the vmstate path.

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

  This release moves live mounts fully into the VMM via multi-slot virtio-fs, removes the old FUSE-over-vsock transport, consolidates the native host tools into the `@machinen/native-x64-*` packages, and makes vmstate snapshots/restores the default path with asynchronous writes and faster restore handling.
