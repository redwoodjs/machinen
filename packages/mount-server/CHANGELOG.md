# @machinen/mount-server

## 0.8.2

## 0.8.1

## 0.8.0

## 0.7.2

## 0.7.1

## 0.7.0

### Patch Changes

- 90f20ca: Move more boot, provision, restore, live-mount, and vmstate planning into the Zig runtime helper/VMM boundary. This keeps TypeScript focused on orchestration, improves live-mount batching and metadata handling, and fixes the first KVM vmstate checkpoint dirty-bitmap path.

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.2

## 0.4.1

## 0.4.0

## 0.3.4

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
