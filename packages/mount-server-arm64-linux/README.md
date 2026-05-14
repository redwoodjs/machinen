# @machinen/mount-server-arm64-linux

Zig-native FUSE-over-vsock mount-server binary for arm64 linux hosts
(#329). Sibling of `@machinen/mount-server-arm64-darwin`, cross-compiled
from the same `@machinen/mount-server` Zig source via
`zig build -Dtarget=aarch64-linux-gnu` (works from any host).

CI stages `bin/machinen-mount-server` during publish; locally, run
`bash scripts/build-mount-server.sh` from the repo root — it produces
both host targets in one pass.
