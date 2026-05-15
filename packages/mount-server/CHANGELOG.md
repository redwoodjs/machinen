# @machinen/mount-server

## 0.3.0

### Minor Changes

- Ship the virtio-fs live-mount transport and the vmstate snapshot pipeline.

  This release moves live mounts fully into the VMM via multi-slot virtio-fs, removes the old FUSE-over-vsock transport, consolidates the native host tools into the `@machinen/native-arm64-*` packages, and makes vmstate snapshots/restores the default path with asynchronous writes and faster restore handling.
