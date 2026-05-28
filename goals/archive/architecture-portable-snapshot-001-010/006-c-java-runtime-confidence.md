# Goal 006: C and Java runtime confidence profiles

## Motivation

Shell commands and tiny HTTP services are not enough to make a architecture-portable snapshot claim
credible. C exposes native ABI and kernel-resource boundaries. Java/JVM exposes a
heavy runtime with threads, mappings, class metadata, JIT state, and many loaded
files. Passing or honestly refusing these profiles tells us whether the model is
real.

## Objective

Create a classified C and Java/JVM proof matrix for cross-architecture portable
restore work.

Each profile must be classified as:

- `product-supported`
- `proof-only-feasibility`
- `stretch-demo`
- `refused`

## Required C profiles

- [x] Static C binary profile.
- [x] Dynamic C binary profile.
- [x] C file IO profile.
- [x] C timer profile.
- [x] C signal profile.
- [x] C TCP listener profile.

For each profile, record whether state is preserved, recreated, drained,
dropped-irrelevant, logically-restored, or refused.

## Required Java/JVM profiles

- [x] JVM loop or small service profile.
- [x] Record JVM vendor/version.
- [x] Record classpath/artifact provenance.
- [x] Record loaded native libraries where possible.
- [x] Target-native verifier output.
- [x] Refuse unsupported JVM-private state, JIT ambiguity, native libraries,
      threads, active sockets, signal/timer state, or process topology unless
      explicitly modeled.

## Machine-readable output

Each row must include:

- `kind: machinen.architecture-portable-snapshot.runtime-confidence-profile`
- `runtime: c | java`
- `profile`
- `classification`
- `sourceArch`
- `targetArch`
- `stateModel`
- `artifactDigests`
- `runtimeVersion`
- `verifierOutput`
- `migrationCompleted`
- refusal code/remediation when refused

## Refusal requirements

Refuse instead of silently dropping:

- active sockets;
- native library ambiguity;
- unmodeled signal/timer state;
- JVM-private/JIT state;
- unsupported process topology;
- source/target ABI mismatch;
- missing target runtime or dynamic library provenance.

## Tests and smokes

- [x] C static profile smoke.
- [x] C dynamic profile smoke/refusal depending on model.
- [x] C file/timer/signal/TCP listener smokes or classified proof fixtures.
- [x] JVM loop/service smoke or explicit refusal smoke.
- [x] Product classification tests.

## Documentation

- [x] Explain why each profile is product-supported, proof-only, stretch, or
      refused.
- [x] Explain user remediation for C dynamic libs and JVM-private state.

## Validation

Run and record timing for:

- [x] C/Java profile matrix;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
