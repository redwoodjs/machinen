# @machinen/runtime

## 0.4.1

### Patch Changes

- Publish fixed x64 Linux VMM with `noapic` in the guest kernel command line.

## 0.4.0

### Minor Changes

- 37cf5fa: Ship amd64 Linux/KVM guest support.

  The release now publishes the `@machinen/native-x64-linux` host package and amd64 base assets (`bzImage-x86_64`, `rootfs-debian-amd64.tar.gz`, and the prebaked rootfs image). On amd64 Linux hosts, the CLI/runtime select amd64 guest assets by default and same-architecture amd64 snapshot/restore uses the vmstate path.

- bd30262: Add opt-in nested virtualization for arm64 hosts.

  `boot({ nested: true })` and `machinen boot --nested` now ask the VMM to expose EL2 to the guest. Linux/KVM uses `KVM_CAP_ARM_EL2` and `KVM_ARM_VCPU_HAS_EL2`; macOS uses Hypervisor.framework's EL2 VM config when available. The guest kernel config now builds KVM in so `/dev/kvm` can appear inside nested-capable guests, masks SVE/SME features that HVF cannot virtualize at EL2, and uses a nested-safe poweroff marker when PSCI terminates inside the L1 guest. Provider-level snapshots of nested-enabled VMs are refused until EL2 vmstate capture is fully audited. Docs now include a Firecracker guide, plus an example that boots an aarch64 Firecracker L2 inside machinen.

### Patch Changes

- ca23f28: Mix fresh host entropy into vmstate restores and expose vmstate smoke repros for timer, entropy, and socket contracts.

## 0.3.4

## 0.3.3

### Patch Changes

- Complete the next live-mount compatibility slice by implementing virtio-fs `READLINK` and `LINK`, applying executable mode changes from `SETATTR`, and adding smoke coverage for symlink resolution, hardlinks, and `chmod +x` execution.

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

## 0.2.0

### Minor Changes

- 046a012: Implement xattr ops in the live-mount FUSE server (#321).

  Closes #321.

  The mount-server previously returned `ENOSYS` for `SETXATTR` (21),
  `GETXATTR` (22), `LISTXATTR` (23), and `REMOVEXATTR` (24). Tools never
  crashed but every extended attribute written or read by the guest
  inside a live mount silently vanished — `setcap` no-op'd, `rsync -X`
  quietly lost data, `getfattr -d` came back empty regardless of what
  the host actually stored. This change wires up all four ops end to
  end against the host filesystem.

  **Strategy.** Per-call shell-out to the platform-native tools, matching
  issue #321's "Option A":
  - darwin: `xattr -p -s -x` / `xattr -w -s -x` / `xattr -s` / `xattr -d -s`
  - linux: `getfattr --only-values` / `setfattr -v 0sBASE64` /
    `getfattr --match=.` / `setfattr -x`

  `-s` (darwin) and `--no-dereference` (linux) keep the call on the
  symlink itself rather than its target, mirroring the rest of the
  mount-server's existing `lstat`-shaped ops. Per-op cost is ~5–20 ms;
  acceptable for the workloads the live-mount path was built for
  (install-time `setcap`, occasional SELinux relabel, tar extracts with
  xattrs). A future native-binding replacement can swap the internals
  without changing the wire-side handlers.

  **Namespace handling.** Names round-trip verbatim — no Linux
  `user.*` / `security.*` / `trusted.*` translation. On a Linux host
  the kernel polices the privileged namespaces, so a guest's `setcap`
  lands as `EPERM` unless the host is root, which is closer-to-correct
  degradation than the previous silent loss. On a darwin host names
  aren't gated at all, so every name stores and reads cleanly inside the
  mount — only invisible to Linux-specific host tools (`getcap` etc.),
  which is the documented trade-off in the issue.

  **XATTR_CREATE / XATTR_REPLACE.** The flag bits in `fuse_setxattr_in`
  are honoured by a pre-existence check before the write, returning
  `EEXIST` / `ENODATA` respectively. There's a TOCTOU race against
  direct host-side activity outside the guest's view, but inside the
  single mount the FUSE channel serialises every op, so the window only
  matters when a third party writes through the host fs directly.

  **ENODATA / ERANGE.** Both are added to the mount-server's `ERRNO`
  table. macOS's `ENOATTR` (errno 93) is normalised to Linux's `ENODATA`
  (61) on the wire so the guest kernel sees the canonical "no such
  attribute" code regardless of host.

  **Tests** in `mount-server.test.ts` follow the project's FUSE-op rules
  in `CLAUDE.md`:
  - Happy round-trip: set → probe → fetch → list → remove → re-get
    yields `-ENODATA`.
  - Error: `-ENODATA` on get of an unset attribute; `-ERANGE` when the
    caller's fetch buffer is smaller than the value.
  - `:ro` gate: `SETXATTR` and `REMOVEXATTR` return `-EROFS` and never
    touch the host; `GETXATTR` and `LISTXATTR` are allowed.
  - Wedge guard: every assertion goes through `raceWithDeadline()` so a
    hang becomes a fast, specific test failure.

  The four opcodes are removed from `UNIMPLEMENTED_OPS` in the same
  file. Tests skip automatically when the host has neither
  `getfattr`/`setfattr` (Linux) nor `xattr` (darwin) on `PATH` — a
  developer without `attr` installed still gets a green local suite,
  CI installs the package.

### Patch Changes

- 9c0b8ec: Fix `VsockExec.run` collecting a parallel buffered copy of every
  chunk when the caller passes `onStdout` / `onStderr`. The buffered
  copy was concatenated and decoded as UTF-8 at finish time, so any
  streaming caller whose cumulative output crossed V8's ~512 MiB max
  string length crashed with `ERR_STRING_TOO_LONG` from
  `Buffer.concat(...).toString("utf8")` in `finish()`.

  The snapshot path uses `onStdout` to pump criu tar bytes into a
  host-side `tar -x`. For workloads with more than ~512 MiB of dirty
  pages the dump produces enough stdout to trip the limit, so every
  such snapshot failed with a V8 internal error instead of completing.
  The S5 smoke test (`scripts/smoke-tests.sh`, 2 GiB-dirty workload)
  was the most visible victim — closing #325.

  Fix: when `onStdout` is set, skip pushing chunks into `stdoutBufs`;
  same for `onStderr` / `stderrBufs`. The result's `stdout` / `stderr`
  fields come back as empty strings for streaming callers, which is
  documented in `VsockExecResult` and is what those callers want
  anyway — they already have the bytes via the callback.

  Adds `__tests__/exec-streaming.test.ts` covering: streamed-stdout
  result is empty + callback sees every byte, same for stderr, the
  existing buffered path still collects when no callback is set, and
  the mixed case (one channel streamed, the other buffered).

  Closes #325.

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
