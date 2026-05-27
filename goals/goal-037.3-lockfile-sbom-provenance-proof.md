# Goal 37.3: Lockfile and SBOM provenance proof

Parent: [Goal 37](./goal-037.md).

## Objective

Prove package provenance using lockfile and SBOM metadata without contacting a
registry or running third-party install scripts.

## Requirements

- [x] Generate or check in lockfile fixtures for the local audited registry.
- [x] Generate or check in SBOM/provenance fixtures with package hashes,
      dependency graph edges, native artifact hashes, and policy decisions.
- [x] Verify package graph integrity, package hash integrity, native artifact
      integrity, and runtime manifest consistency.
- [x] Refuse lockfile drift, missing package hashes, unexpected dependency edges,
      native artifact digest drift, and unresolved optional/peer dependency
      ambiguity.
- [x] Add checked summaries for positive provenance and negative drift cases.

## Validation

- [x] Lockfile/SBOM positive provenance smoke.
- [x] Lockfile/package/native digest drift refusal matrix.
- [x] Optional/peer ambiguity refusal tests.
- [x] Runtime manifest and docs updated.
- [x] Relevant static checks from Goal 37.

## Completion criteria

Complete when lockfile and SBOM provenance are verified offline and every drift
case refuses with a stable code.

## Completion note

Completed as part of umbrella Goal 37. See
[Goal 37 completion validation record](./goal-037.md#completion-validation-record)
for implementation and validation evidence.
