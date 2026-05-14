# @machinen/native-arm64-darwin

All of machinen's host-side native binaries for arm64 darwin, in one
package:

| subdir       | contents                                           |
| ------------ | -------------------------------------------------- |
| `vmm/`       | `machinen-vm` (HVF microVM), `gvproxy`, guest ELFs |
| `e2fsprogs/` | bundled `mke2fs` + its dylibs                      |
| `squashfs/`  | bundled `mksquashfs` + its dylibs                  |

This replaces the former per-tool packages
(`@machinen/vmm-arm64-darwin`, `@machinen/e2fsprogs-arm64-darwin`,
`@machinen/squashfs-tools-arm64-darwin`) — one install, one
`optionalDependency`, one `os`/`cpu` gate per host.

`index.mjs` exports an absolute path per binary: `binary` (the VMM),
`gvproxy`, `initPath`, `execAgentPath`, `mke2fs`, `mksquashfs`.

Per-tool subdirs are deliberate: the bundled e2fsprogs/squashfs
binaries load their dylibs via `@loader_path/../lib`, so each tool's
`bin/` and `lib/` must stay siblings.

The VMM, gvproxy, and guest ELFs are CI-staged on publish (absent in
the repo); the e2fsprogs/squashfs binaries are committed. Locally,
`scripts/build-vmm.sh`, `scripts/install-gvproxy.sh`, and the
base-asset build populate the staged paths.
