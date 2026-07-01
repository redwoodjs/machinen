# @machinen/cli

## 0.7.0

### Patch Changes

- 90f20ca: Move more boot, provision, restore, live-mount, and vmstate planning into the Zig runtime helper/VMM boundary. This keeps TypeScript focused on orchestration, improves live-mount batching and metadata handling, and fixes the first KVM vmstate checkpoint dirty-bitmap path.
- 90f20ca: Remove the experimental public `move` command and its proof-only harnesses from the shipped CLI/runtime surface while keeping the snapshot/restore product path focused on vmstate.
- Updated dependencies [90f20ca]
- Updated dependencies [90f20ca]
- Updated dependencies [2ad5f5c]
  - @machinen/runtime@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [4b82923]
  - @machinen/runtime@0.6.1

## 0.6.0

### Minor Changes

- 39300fb: Default VM and persistent PTY session names to `default`, and fix persistent PTY list/reconnect/exit handling so `machinen attach` works as a tmux-like reconnectable shell by default.
- 680301e: Add goal-driven CPU resource policies with `resources.cpu.maxVcpus`, `quotaCpus`, and `weight`, CLI flags for boot/fork, Linux cgroup v2 quota/fairness enforcement, and registry/list observability.

### Patch Changes

- Updated dependencies [39300fb]
- Updated dependencies [680301e]
  - @machinen/runtime@0.6.0

## 0.5.0

### Minor Changes

- c973069: Add persistent attach sessions for reconnectable interactive VM shells and TUIs. Use `machinen attach --session <name> <vm>` to create or reattach a named guest-managed PTY session, `machinen sessions <vm>` to list them, and `machinen session-kill <vm> <session>` to reset one. Plain `machinen attach <vm>` keeps the existing non-persistent behavior.

### Patch Changes

- Updated dependencies [2a9085e]
- Updated dependencies [f8f84c2]
- Updated dependencies [c973069]
  - @machinen/runtime@0.5.0

## 0.4.2

### Patch Changes

- Download and publish base assets from the main `redwoodjs/machinen` GitHub Releases instead of `redwoodjs/machinen.dev`.
- Updated dependencies
  - @machinen/runtime@0.4.2

## 0.4.1

### Patch Changes

- Publish fixed x64 Linux VMM with `noapic` in the guest kernel command line.
- Updated dependencies
  - @machinen/runtime@0.4.1

## 0.4.0

### Minor Changes

- 37cf5fa: Ship amd64 Linux/KVM guest support.

  The release now publishes the `@machinen/native-x64-linux` host package and amd64 base assets (`bzImage-x86_64`, `rootfs-debian-amd64.tar.gz`, and the prebaked rootfs image). On amd64 Linux hosts, the CLI/runtime select amd64 guest assets by default and same-architecture amd64 snapshot/restore uses the vmstate path.

- bd30262: Add opt-in nested virtualization for arm64 hosts.

  `boot({ nested: true })` and `machinen boot --nested` now ask the VMM to expose EL2 to the guest. Linux/KVM uses `KVM_CAP_ARM_EL2` and `KVM_ARM_VCPU_HAS_EL2`; macOS uses Hypervisor.framework's EL2 VM config when available. The guest kernel config now builds KVM in so `/dev/kvm` can appear inside nested-capable guests, masks SVE/SME features that HVF cannot virtualize at EL2, and uses a nested-safe poweroff marker when PSCI terminates inside the L1 guest. Provider-level snapshots of nested-enabled VMs are refused until EL2 vmstate capture is fully audited. Docs now include a Firecracker guide, plus an example that boots an aarch64 Firecracker L2 inside machinen.

### Patch Changes

- Updated dependencies [37cf5fa]
- Updated dependencies [bd30262]
- Updated dependencies [ca23f28]
  - @machinen/runtime@0.4.0

## 0.3.4

### Patch Changes

- @machinen/runtime@0.3.4

## 0.3.3

### Patch Changes

- Complete the next live-mount compatibility slice by implementing virtio-fs `READLINK` and `LINK`, applying executable mode changes from `SETATTR`, and adding smoke coverage for symlink resolution, hardlinks, and `chmod +x` execution.
- Updated dependencies
  - @machinen/runtime@0.3.3

## 0.3.2

### Patch Changes

- Fix virtio-fs `rmdir` on non-empty directories to return `ENOTEMPTY` instead of surfacing as guest `EIO`, and add directory-removal coverage for live mounts.
- Updated dependencies
  - @machinen/runtime@0.3.2

## 0.3.1

### Patch Changes

- Fix virtio-fs live mounts writing to existing files.

  Writable opens now keep a read-capable host fd so Linux writeback-cache READ-fill requests on `O_WRONLY` handles do not surface as `EIO`. `SETATTR` now applies size truncation, and `RENAME` is implemented so `mv`/overwrite workflows work inside `--mount-live`.

- Updated dependencies
  - @machinen/runtime@0.3.1

## 0.3.0

### Minor Changes

- Ship the virtio-fs live-mount transport and the vmstate snapshot pipeline.

  This release moves live mounts fully into the VMM via multi-slot virtio-fs, removes the old FUSE-over-vsock transport, consolidates the native host tools into the `@machinen/native-arm64-*` packages, and makes vmstate snapshots/restores the default path with asynchronous writes and faster restore handling.

### Patch Changes

- Updated dependencies
  - @machinen/runtime@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [9c0b8ec]
- Updated dependencies [046a012]
  - @machinen/runtime@0.2.0

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
