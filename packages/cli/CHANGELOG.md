# @machinen/cli

## 0.1.0

### Minor Changes

- 6ec81c6: Initial public release.
  - `@machinen/cli`: `machinen boot`, `ls`, `exec`, `snapshot`, `attach`, `restore`, `install`, `completion` commands.
  - `@machinen/runtime`: `provision()`, `boot()`, `attach()`, `list()` + `VmHandle.exec()` / `VmHandle.snapshot()` for driving microVMs.
  - `@machinen/vmm-arm64-darwin` / `@machinen/vmm-arm64-linux`: native arm64 VMM binaries.

### Patch Changes

- Updated dependencies [9e27b02]
  - @machinen/runtime@0.1.0
