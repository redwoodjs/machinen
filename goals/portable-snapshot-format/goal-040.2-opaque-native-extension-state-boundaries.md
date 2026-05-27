# Goal 40.2: Opaque native extension state boundaries

Parent: [Goal 40](./goal-040.md).

## Objective

Determine whether native extension state can be portably restored only through
explicit audited contracts, or must remain fail-closed. This covers Go cgo, JVM
JNI, Ruby native gems, and Python C extensions.

## Requirements

- [x] Add audited native-extension fixtures for: - Go cgo; - JVM JNI; - Ruby native gem shape; - Python C-extension shape.
- [x] For each runtime, include at least one explicit-contract positive fixture
      or explain why support cannot be claimed yet.
- [x] For each runtime, include opaque-state refusal fixtures covering native
      heap pointers, file descriptors owned by native code, background native
      threads, callbacks into the managed runtime, and ABI/build-id drift.
- [x] Record native provenance: - binary path; - SHA-256 digest; - build ID or equivalent; - ABI/runtime version; - target-native artifact availability; - external state contract version.
- [x] Prove target-native reload/rebind for supported explicit-contract subsets.
- [x] Refuse opaque state with stable codes and `migrationCompleted=false`.
- [x] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only native-state claims.

## Suggested refusal codes

- `runtime-native-extension-opaque-state`
- `runtime-native-extension-abi-drift`
- `runtime-native-extension-build-id-mismatch`
- `runtime-native-extension-owned-fd-unsupported`
- `runtime-native-extension-background-thread-unsupported`
- `runtime-native-extension-managed-callback-ambiguous`
- `runtime-native-extension-contract-missing`

## Runtime-specific hazards

- Go cgo: C heap ownership, pinned Go pointers, callbacks, foreign threads.
- JVM JNI: global refs, direct byte buffers, native libraries, JVMTI/agent state.
- Ruby native gems: VALUE handles, global VM lock assumptions, native finalizers.
- Python C extensions: PyObject refs, GIL assumptions, capsule pointers,
  extension-owned file descriptors.

## Validation

- [x] cgo support-or-refusal smoke.
- [x] JNI support-or-refusal smoke.
- [x] Ruby native-gem support-or-refusal smoke.
- [x] Python C-extension support-or-refusal smoke.
- [x] ABI/build-id drift refusal matrix.
- [x] Cross-architecture target-native artifact proof for any supported subset.
- [x] Runtime manifests, proof profiles, checked summaries, docs, and matrices.
- [x] Relevant static checks from Goal 40.

## Completion criteria

Complete when native-extension state is either proven through explicit audited
contracts or refused with stable codes for every cgo/JNI/native-gem/C-extension
state class in scope.

## Completion record

Completed with `scripts/goal40-hard-runtime-state-proof.mjs`, `scripts/smoke/goal40-hard-runtime-state.sh`, checked summaries in `docs/snapshot/checked-summaries/goal40-hard-state/`, proof profiles, matrix presets, runtime manifest updates, and `docs/snapshot/hard-runtime-state-boundaries.md`. Final validation passed on 2026-05-25.
