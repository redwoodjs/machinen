# @machinen/native-arm64-linux

All of machinen's host-side native binaries for arm64 linux, in one
package:

| subdir          | contents                                           |
| --------------- | -------------------------------------------------- |
| `vmm/`          | `machinen-vm` (KVM microVM), `gvproxy`, guest ELFs |
| `e2fsprogs/`    | bundled `mke2fs`                                   |
| `squashfs/`     | bundled `mksquashfs`                               |
| `mount-server/` | Zig-native FUSE-over-vsock mount server (#329)     |

This replaces the four former per-tool packages
(`@machinen/vmm-arm64-linux`, `@machinen/e2fsprogs-arm64-linux`,
`@machinen/squashfs-tools-arm64-linux`,
`@machinen/mount-server-arm64-linux`) — one install, one
`optionalDependency`, one `os`/`cpu` gate per host.

`index.mjs` exports an absolute path per binary: `binary` (the VMM),
`gvproxy`, `initPath`, `fuseAgentPath`, `execAgentPath`, `mke2fs`,
`mksquashfs`, `mountServer`.

Unlike the darwin sibling, the linux e2fsprogs/squashfs binaries don't
ship a `lib/` — they link statically / against the host's libc.

The VMM, gvproxy, guest ELFs, and mount-server binary are CI-staged on
publish (absent in the repo); the e2fsprogs/squashfs binaries are
committed.
