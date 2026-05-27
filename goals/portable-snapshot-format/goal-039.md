# Goal 39: Python and Go non-Node cross-architecture proof hardening

Parent context: Goal 38 established local audited support-or-refusal envelopes
for JVM, Python, Ruby, and Go. Goal 39 strengthens the two runtimes with the
best current proof footing: Python and Go.

## Objective

Add repeatable bidirectional `arm64 <-> amd64` target-native proofs for Python
Django/Celery-style and Go service/runtime fixtures without broadening claims to
unsupported states.

## Requirements

- [x] Run Python on real arm64 and amd64 hosts with an audited local
      Django/Celery-style fixture.
- [x] Run Go on real arm64 and amd64 hosts using target-native static no-cgo
      Linux binaries built from the audited fixture.
- [x] Cover both `arm64 -> amd64` and `amd64 -> arm64` routes.
- [x] Repeat each host execution enough times to prove stable semantic
      fingerprints.
- [x] Keep shortcut guards explicit: no source-ISA emulation, source text replay
      shortcut, sidecar runtime, or app hook success.
- [x] Publish checked summaries, proof profiles, runtime manifest updates,
      matrix presets, smoke script, and user-facing documentation.
- [x] Keep JVM and Ruby expansion out of scope except as documented next steps.

## Validation

- [x] `pnpm smoke-non-node-cross-arch -- --keep --work-dir /tmp/goal39-cross --iterations 3`
- [x] `node scripts/portable-machine-proof-matrix.mjs --preset non-node-cross-arch --check-summary-dir docs/snapshot/checked-summaries/non-node-cross-arch --json`
- [x] Full static checks and focused tests from the completion record.

## Completion record

Completed with `scripts/non-node-cross-arch-proof.mjs`,
`scripts/smoke/non-node-cross-arch.sh`, checked summaries in
`docs/snapshot/checked-summaries/non-node-cross-arch/`, Python/Go runtime
manifest updates, and matrix presets `non-node-cross-arch`,
`runtime-python-cross-arch`, and `runtime-go-cross-arch`.
