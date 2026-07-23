# @machinen/native-arm64-darwin

All of machinen's host-side native binaries for arm64 darwin, in one
package:

| subdir       | contents                                                 |
| ------------ | -------------------------------------------------------- |
| `vmm/`       | `machinen-vm`, `machinen-session`, `gvproxy`, guest ELFs |
| `e2fsprogs/` | bundled `mke2fs` + its dylibs                            |
| `squashfs/`  | bundled `mksquashfs` + its dylibs                        |

This is the consolidated native optional dependency for this host — one
install, one `optionalDependency`, one `os`/`cpu` gate.

`index.mjs` exports an absolute path per binary: `binary` (the VMM),
`session`, `gvproxy`, `initPath`, `execAgentPath`, `mke2fs`, `mksquashfs`.

Per-tool subdirs are deliberate: the bundled e2fsprogs/squashfs
binaries load their dylibs via `@loader_path/../lib`, so each tool's
`bin/` and `lib/` must stay siblings.

The VMM, session helper, gvproxy, and guest ELFs are CI-staged on publish (absent in
the repo); the e2fsprogs/squashfs binaries are committed. Locally,
`scripts/build-vmm.sh`, `scripts/install-gvproxy.sh`, and the
base-asset build populate the staged paths.
