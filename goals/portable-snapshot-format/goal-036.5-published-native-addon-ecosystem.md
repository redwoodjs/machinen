# Goal 36.5: Published native addon ecosystem

Parent: [Goal 36](./goal-036.md).

## Objective

Move from representative native-addon fixtures to real published Node packages
with native artifacts, install scripts, prebuild layouts, and dynamic library
constraints.

## Requirements

- [x] Select representative native packages, prioritizing `better-sqlite3`,
      `sharp`, `bcrypt`, `canvas`, `sqlite3`, or equivalent packages that cover
      database, image, crypto, and binary dependency classes.
- [x] Install/build packages for source and target routes without using source
      architecture artifacts on the target.
- [x] Inspect package metadata, prebuild selection, install script outputs,
      `.node` files, ABI tags, shared library dependencies, glibc/musl
      constraints, and CPU feature requirements.
- [x] Verify target-native package behavior after restore with real operations
      such as query, image transform, hash/check, or equivalent package-specific
      output.
- [x] Refuse wrong architecture, wrong ABI, missing shared libraries,
      unsupported CPU features, opaque native state, unsafe static initializers,
      and unverifiable postinstall binaries.
- [x] Record package-specific checked summaries and matrix presets.

## Validation

- [x] Published native addon support matrix across Node 20/22/24.
- [x] ABI/architecture/libc/shared-library mismatch refusal matrix.
- [x] Target-native behavior smoke per selected package.
- [x] Artifact inspection proving no source-ISA emulation or source artifact
      reuse.
- [x] Relevant static checks from Goal 36.

## Completion criteria

Complete when real published native packages are covered by a proof-backed matrix
and unsupported native artifact states refuse deterministically.

## Completion note

Completed as part of umbrella Goal 36. See
[Goal 36 completion validation record](./goal-036.md#completion-validation-record)
for implementation and validation evidence.
