# Goal 34.2: Real compiled native addon provenance

Parent: [Goal 34](./goal-034.md).

## Objective

Prove native addon support with an actual compiled `.node` artifact and
target-side ABI/provenance checks, not only a modeled N-API profile.

## Requirements

- [x] Add a real N-API/native addon fixture that builds a `.node` artifact.
- [x] Build or obtain the source-side addon artifact on arm64.
- [x] Build or obtain the target-side addon artifact on amd64.
- [x] Record Node module ABI, N-API version, platform, architecture, compiler,
      source hash, and binary hash provenance.
- [x] Refuse ABI mismatch or stale compiled artifact with a stable code.
- [x] Restore and verify target-side addon behavior after restore.
- [x] Ensure no source `.node` binary is replayed on the target architecture.

## Validation

- [x] Native addon compiled-artifact restore/provenance smoke.
- [x] ABI mismatch refusal test.
- [x] Artifact hash drift refusal test.
- [x] Checked summaries for both arm64 source routes.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when a real compiled native addon is restored with target-safe ABI
provenance, and stale/mismatched addon states refuse safely.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
