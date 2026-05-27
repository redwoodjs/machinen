# Goal 44.3: PostgreSQL expanded repeatability

Parent: [Goal 44](./goal-044.md).

## Objective

Expand Goal 43's PostgreSQL proof from one clean/quiesced fixture to a broader
repeatable PostgreSQL state suite.

## Requirements

- [x] Reuse the Goal 43 PostgreSQL cross-architecture logical restore harness as the base.
- [x] Add repeatability runs for the clean/quiesced PostgreSQL restore path.
- [x] Expand the dataset: - multiple databases; - multiple schemas/tables; - indexes; - constraints; - sequences; - views or materialized views if feasible; - larger row counts.
- [x] Verify logical state after restore with deterministic SQL output.
- [x] Record provenance for every run: PostgreSQL version, SQL digests, data
      manifest, WAL/checkpoint evidence, verifier digest, and repeatability
      fingerprint.
- [x] Add or harden stable refusals for: - prepared statement/session state; - advisory locks; - active transaction; - dirty WAL; - replication slots/logical decoding; - host-mounted data directory ambiguity; - extension/native plugin state.
- [x] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only continuation.

## Validation

- [x] PostgreSQL expanded repeatability smoke.
- [x] PostgreSQL expanded unsafe-neighbor refusal matrix.
- [x] PostgreSQL expanded proof matrix preset.
- [x] Relevant static checks from Goal 44.

## Completion criteria

Complete when PostgreSQL has repeatable, broader logical-state restore proof and
stable refusals for additional database-specific unsafe states.
