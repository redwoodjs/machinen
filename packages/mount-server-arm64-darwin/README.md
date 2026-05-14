# @machinen/mount-server-arm64-darwin

Zig-native FUSE-over-vsock mount-server binary for arm64 darwin
(#329). Drop-in replacement for `@machinen/runtime/dist/mount-server-bin.js`
when `MACHINEN_MOUNT_SERVER_IMPL=zig` is set on the runtime.

The binary itself is built from `@machinen/mount-server` source —
this package is the per-host artifact wrapper, mirroring how
`@machinen/vmm-arm64-darwin` wraps `@machinen/microvm`. CI stages
`bin/machinen-mount-server` during publish; locally, run
`bash scripts/build-mount-server.sh` from the repo root.
