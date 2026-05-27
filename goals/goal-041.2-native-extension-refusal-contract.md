# Goal 41.2: Native extension refusal contract

Parent: [Goal 41](./goal-041.md).

## Objective

Make Goal 40 native-extension refusals stable across Go cgo, JVM JNI, Ruby
native gems, and Python C extensions when explicit external-state contracts are
absent, incomplete, or invalid.

## Stable refusal codes

- `runtime-native-extension-opaque-state`
- `runtime-native-extension-abi-drift`
- `runtime-native-extension-build-id-mismatch`
- `runtime-native-extension-owned-fd-unsupported`
- `runtime-native-extension-background-thread-unsupported`
- `runtime-native-extension-managed-callback-ambiguous`
- `runtime-native-extension-contract-missing`

## Requirements

- [x] Add canonical refusal metadata for each code: message, explanation,
      remediation, and graduation requirements.
- [x] Add or harden fixtures for: - cgo C heap / pinned pointer state; - JNI global references / JVMTI-like agent state; - Ruby native gem retained `VALUE` state; - Python C-extension retained `PyObject` / capsule state; - native-owned file descriptors; - background native threads; - ABI or build-id drift; - missing explicit external-state contract.
- [x] Assert every refusal reports `migrationCompleted=false` and target state
      `refused`.
- [x] Assert no source-ISA emulation, source text replay, sidecar runtime, app
      hook, or metadata-only native-state claim is accepted.
- [x] Document future graduation requirements: binary path, digest, build ID or
      ABI identity, runtime ABI, target-native artifact, external-state contract
      version, and reload/rebind verifier.
- [x] Add matrix coverage that fails on code drift or accidental support.

## Completion criteria

Complete when every cgo/JNI/native-gem/C-extension opaque-state refusal is
stable, documented, and covered by checked summaries and tests.
