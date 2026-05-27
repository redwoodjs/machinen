# Goal 37.2: Native prebuild layout simulation

Parent: [Goal 37](./goal-037.md).

## Objective

Model native npm package prebuild complexity without using third-party native
binaries or install-script generated artifacts.

## Requirements

- [x] Add local native-package fixtures that mimic prebuild layouts such as
      `prebuilds/linux-x64`, `prebuilds/linux-arm64`, ABI-tagged paths, libc
      splits, and optional binary packages.
- [x] Build tiny audited target-native `.node` artifacts from local source only.
- [x] Verify target artifact selection by Node version, N-API/modules ABI, arch,
      libc, platform, and package metadata.
- [x] Refuse wrong architecture, wrong ABI, missing artifact, postinstall-created
      unknown binary, unsupported libc, and opaque native state.
- [x] Record artifact hashes, file identity, ABI metadata, and refusal codes in
      checked summaries.

## Validation

- [x] Native prebuild layout simulation smoke.
- [x] ABI/arch/libc/missing-artifact refusal matrix.
- [x] Target-native `.node` behavior verification.
- [x] Artifact inspection proving no source-ISA emulation or third-party binary
      reuse.
- [x] Relevant static checks from Goal 37.

## Completion criteria

Complete when native prebuild complexity is modeled with audited local artifacts
and unsupported native states refuse deterministically.

## Completion note

Completed as part of umbrella Goal 37. See
[Goal 37 completion validation record](./goal-037.md#completion-validation-record)
for implementation and validation evidence.
