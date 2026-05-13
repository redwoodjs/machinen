---
"@machinen/runtime": patch
---

Fix two more host-tool binaries shipped without the executable bit
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
