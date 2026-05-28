# Goal 009: Final proof gauntlet checked summary

Parent: [`FINAL-GOAL.md`](./FINAL-GOAL.md)

## Motivation

The final cross-architecture CRIU-like claim needs one machine-readable proof
suite. Individual smokes are useful, but the product claim should be audited from
a single checked summary with one row per claim.

## Objective

Build the final proof gauntlet runner and checked-summary format that aggregates
Goals 002-008.

## Required rows

The gauntlet must include rows for:

- [x] opposite-ISA VM execution;
- [x] PostgreSQL bidirectional logical restore;
- [x] PostgreSQL unsafe-neighbor refusals;
- [x] SQLite rollback-journal restore;
- [x] SQLite WAL-checkpoint restore;
- [x] SQLite dirty/in-flight refusals;
- [x] guest CRIU simple C process;
- [x] guest CRIU JVM process or JVM refusal;
- [x] portable snapshot plus guest CRIU composition;
- [x] C runtime confidence profiles;
- [x] Java/JVM runtime confidence profiles;
- [x] seccomp proof/refusal;
- [x] eBPF proof/refusal;
- [x] namespace/cgroup/capability classification;
- [x] nested virtualization stretch proof/refusal.

## Row schema

Each row must state:

- `claimId`
- `claimName`
- `classification: product-supported | proof-only-feasibility | stretch-demo | refused | skipped`
- `sourceArch`
- `targetArch`
- `hostArch`
- `providerMode`
- `targetExecution: native | accelerated | emulated | not-applicable`
- `stateModel`
- `stateDecisions`
- `verifierCommand`
- `verifierOutput`
- `artifactDigests`
- `provenance`
- `migrationCompleted`
- `refusalCode` when refused
- `remediation` when refused

## Global invariants

The gauntlet fails if:

- [x] unsupported source-ISA emulation is reported as product restore success;
- [x] raw cross-ISA CRIU image replay is reported as product restore success;
- [x] sidecar success is reported as workload restore success;
- [x] metadata-only continuation is reported as restore success;
- [x] a refused row has `migrationCompleted=true`;
- [x] a product-supported row lacks target-native verifier output;
- [x] artifact digests or provenance are missing for product-supported rows.

## Output files

- [x] `docs/snapshot/checked-summaries/cross-arch-criu/final-gauntlet.json`
- [x] optional per-family checked summaries under the same directory
- [x] docs explaining how to reproduce the gauntlet

## Tests and smokes

- [x] Unit tests for row schema validation.
- [x] Unit tests for global invariant failures.
- [x] Runner smoke with a small fixture matrix.
- [x] Full gauntlet smoke on the supported host matrix.

## Documentation

- [x] Explain classification values.
- [x] Explain what is product-supported vs proof-only vs stretch.
- [x] Explain why refusals are part of the proof, not failures of the roadmap.

## Validation

Run and record timing for:

- [x] final gauntlet runner;
- [x] schema/invariant unit tests;
- [x] relevant family smokes;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
