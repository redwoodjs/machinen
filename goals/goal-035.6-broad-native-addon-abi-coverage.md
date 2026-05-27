# Goal 35.6: Broad native addon and ABI coverage

Parent: [Goal 35](./goal-035.md).

## Objective

Expand native addon proof coverage beyond the single Goal 34 N-API addon into a
representative support/refusal matrix for real-world `.node` artifacts and ABI
situations.

## Requirements

- [x] Build a native addon inventory covering N-API stable ABI, V8/node-module
      ABI, Node 20/22/24 ABI changes, libc/glibc dependencies, dynamic library
      dependencies, architecture-specific code paths, CPU feature gates, and
      prebuild-style package layouts.
- [x] Prove target-side native addon loading and behavior for supported cases
      using target-native `.node` artifacts, not source ISA emulation.
- [x] Verify addon provenance: build inputs, target architecture, ABI tag,
      dependency shared objects, symbol surface, and package metadata.
- [x] Refuse mismatched or unsafe cases: wrong architecture, wrong ABI, missing
      shared library, unsupported CPU feature, postinstall-generated unknown
      binary, opaque native state, and unsafe static initializers.
- [x] Cover at least one real published native-addon package or a fixture that
      faithfully mirrors its install/prebuild layout.
- [x] Add matrix presets, checked summaries, docs, and stable refusal codes.

## Validation

- [x] Native addon support matrix for Node 20/22/24.
- [x] ABI mismatch and architecture mismatch refusal tests.
- [x] Dynamic library dependency inspection tests.
- [x] Published-package/prebuild-layout smoke or equivalent faithful fixture.
- [x] Cross-architecture target-native addon behavior verification.
- [x] Relevant static checks from Goal 35.

## Completion criteria

Complete when native addon support is represented by a broad, explicit,
proof-backed ABI matrix and unsupported addon situations refuse deterministically.

## Completion note

Completed as part of umbrella Goal 35. See
[Goal 35 completion validation record](./goal-035.md#completion-validation-record)
for implementation and validation evidence.
