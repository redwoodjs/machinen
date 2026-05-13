# @machinen/cli

## 0.1.2

### Patch Changes

- Updated dependencies [e9c0e4a]
  - @machinen/runtime@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [76d247a]
- Updated dependencies [275d842]
  - @machinen/runtime@0.1.1

## 0.1.0

### Minor Changes

- c27cdc8: Initial public release.
  - `@machinen/cli` — `machinen boot`, `ls`, `exec`, `snapshot`, `attach`, `restore`, `fork`, `stop`, `install`, `completion`. Positional VM targeting (`machinen exec worker -- ps aux`).
  - `@machinen/runtime` — `provision()`, `boot()`, `attach()`, `list()`, `restore()`; `VmHandle.exec()`, `.snapshot()`, `.fork()`, `.writeFile()`. Optional deps pull the right VMM, mkfs/squashfs-tools binaries for the host arch.
  - `@machinen/vmm-arm64-darwin` / `@machinen/vmm-arm64-linux` — native arm64 VMM (HVF on darwin, KVM on Linux). Ad-hoc-signed darwin build carries the hypervisor entitlement.
  - `@machinen/e2fsprogs-arm64-{darwin,linux}` — bundled `mke2fs` so the runtime can materialise ext4 rootfs images without a host install.
  - `@machinen/squashfs-tools-arm64-{darwin,linux}` — bundled `mksquashfs` for the read-only squashfs lower in `--mount` overlays.

  Base assets (kernel, dtb, Debian rootfs tarball) ship as a GitHub Release on the public companion repo `github.com/redwoodjs/machinen.dev`; the CLI fetches them anonymously on first run.

### Patch Changes

- Updated dependencies [c27cdc8]
  - @machinen/runtime@0.1.0
