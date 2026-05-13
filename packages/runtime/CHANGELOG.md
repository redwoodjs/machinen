# @machinen/runtime

## 0.1.2

### Patch Changes

- e9c0e4a: Fix two more host-tool binaries shipped without the executable bit
  (issue #309 follow-up). The first pass for #309 added the `bin` field
  to `@machinen/vmm-arm64-{darwin,linux}` so pnpm pack would keep
  `bin/machinen-vm` and `bin/gvproxy` executable in the published
  tarball, but missed the same regression in the four sibling binary
  packages: `@machinen/e2fsprogs-arm64-{darwin,linux}` and
  `@machinen/squashfs-tools-arm64-{darwin,linux}` each ship a single
  binary node spawns (`mke2fs`, `mksquashfs`) and each landed on the
  registry at `0.1.1` with mode `0644`. The runtime spawns these from
  the package's `bin/` dir directly, so they'd fail at `provision()` /
  `--mount` time the same way `gvproxy` did at boot.

  Each of the four packages now declares its binary in `bin`
  (`machinen-mke2fs` / `machinen-mksquashfs`, namespaced to avoid
  colliding with system-installed tools in `node_modules/.bin/`).

  `scripts/verify-vmm-packages.sh` is replaced by the broader
  `scripts/verify-bin-packages.sh`, which covers all six host-tool
  packages — every binary the runtime would spawn gets a release-time
  check that the tarball ships it with `+x`.

## 0.1.1

### Patch Changes

- 76d247a: `API.md` no longer carries "Defined in: errors.ts:145" links pointing
  at private-repo source paths. The reference is leaner and stands on
  its own without needing the source tree alongside it. typedoc
  `disableSources` change with no behavioural impact.
- 275d842: Fix `@machinen/runtime@0.1.0` being unusable from a fresh `npm install`
  (issue #309). Two packaging-tarball regressions, fixed together:
  1. **VMM binaries shipped without the executable bit.** `pnpm pack`
     normalizes file modes to 0644 unless the file is declared in the
     `bin` field of `package.json`. The release workflow's `chmod +x` ran
     on the source dir but the mode bit got stripped during pack, so
     `@machinen/vmm-arm64-{darwin,linux}` published `bin/machinen-vm` +
     `bin/gvproxy` as 0644 and `boot()` exited at gvproxy spawn with
     `code=127`. Each vmm package now declares those two paths in `bin`
     (`machinen-vm` + `machinen-gvproxy`), which makes pack preserve
     `0755`.

  2. **Guest binaries (init / fuse-agent / exec-agent) missing on a
     fresh install.** `defaultInitPath()` etc. pointed at
     `packages/microvm/test-fixtures/`, but `@machinen/microvm` was
     `private: true` and never shipped — so an `npm i @machinen/runtime`
     consumer hit `MKINITRAMFS_INIT_MISSING` at the first `boot()`. The
     three arm64-linux ELFs now ride alongside the host VMM in
     `@machinen/vmm-arm64-{darwin,linux}/guest/`, and the runtime
     resolves them through the same `@machinen/vmm-*` package it already
     loads for the host binary. Workspace dev falls back to the in-tree
     `microvm/test-fixtures/` layout, so `pnpm test` keeps working
     without re-staging.

  The release workflow also gains `scripts/verify-vmm-packages.sh`, run
  before `changeset publish`, which packs each vmm-arm64-\* and asserts
  the tarball has executable host binaries + all three guest binaries —
  the regression caught here can't ship again silently.

## 0.1.0

### Minor Changes

- c27cdc8: Initial public release.
  - `@machinen/cli` — `machinen boot`, `ls`, `exec`, `snapshot`, `attach`, `restore`, `fork`, `stop`, `install`, `completion`. Positional VM targeting (`machinen exec worker -- ps aux`).
  - `@machinen/runtime` — `provision()`, `boot()`, `attach()`, `list()`, `restore()`; `VmHandle.exec()`, `.snapshot()`, `.fork()`, `.writeFile()`. Optional deps pull the right VMM, mkfs/squashfs-tools binaries for the host arch.
  - `@machinen/vmm-arm64-darwin` / `@machinen/vmm-arm64-linux` — native arm64 VMM (HVF on darwin, KVM on Linux). Ad-hoc-signed darwin build carries the hypervisor entitlement.
  - `@machinen/e2fsprogs-arm64-{darwin,linux}` — bundled `mke2fs` so the runtime can materialise ext4 rootfs images without a host install.
  - `@machinen/squashfs-tools-arm64-{darwin,linux}` — bundled `mksquashfs` for the read-only squashfs lower in `--mount` overlays.

  Base assets (kernel, dtb, Debian rootfs tarball) ship as a GitHub Release on the public companion repo `github.com/redwoodjs/machinen.dev`; the CLI fetches them anonymously on first run.
