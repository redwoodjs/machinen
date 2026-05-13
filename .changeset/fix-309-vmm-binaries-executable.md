---
"@machinen/runtime": patch
---

Fix `@machinen/runtime@0.1.0` being unusable from a fresh `npm install`
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
