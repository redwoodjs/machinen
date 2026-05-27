# Goal 36.7: Broader OS/runtime/architecture matrix

Parent: [Goal 36](./goal-036.md).

## Objective

Expand the runtime matrix beyond the current Node 20/22/24 and Linux glibc proof
routes, while recording precise OS/libc/native-dependency boundaries.

## Requirements

- [x] Evaluate Node 18 in addition to Node 20/22/24 and support or refuse it with
      stable version/ABI reasons.
- [x] Cover Debian and Ubuntu glibc target/source combinations for supported app
      classes.
- [x] Evaluate Alpine/musl and support or refuse it with explicit libc/native
      dependency evidence.
- [x] Verify both architecture directions for every supported OS/runtime subset:
      arm64 -> amd64 and amd64 -> arm64.
- [x] Record Node, V8, libuv, OpenSSL, modules ABI, N-API, libc, distro, kernel,
      package manager, and native dependency provenance.
- [x] Refuse unsupported combinations such as missing target-native artifacts,
      ABI drift, libc drift, unsupported kernel/runtime features, or unavailable
      dependency services.

## Validation

- [x] Node 18/20/22/24 version matrix.
- [x] Debian/Ubuntu glibc OS matrix.
- [x] Alpine/musl support-or-refusal matrix.
- [x] Bidirectional architecture matrix for supported combinations.
- [x] Runtime manifest and docs updated with exact route boundaries.
- [x] Relevant static checks and full smoke tests from Goal 36.

## Completion criteria

Complete when OS/runtime/architecture support is broadened and every unsupported
combination has deterministic refusal evidence.

## Completion note

Completed as part of umbrella Goal 36. See
[Goal 36 completion validation record](./goal-036.md#completion-validation-record)
for implementation and validation evidence.
