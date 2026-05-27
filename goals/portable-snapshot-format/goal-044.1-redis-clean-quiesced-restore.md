# Goal 44.1: Redis clean/quiesced restore

Parent: [Goal 44](./goal-044.md).

## Objective

Prove a clean/quiesced Redis snapshot/restore subset inside Machinen and define
stable refusals for unsafe Redis states.

## Requirements

- [x] Add an audited Redis fixture with configuration, seed data, workload, and
      verifier.
- [x] Cover persistence modes: - RDB snapshot; - AOF enabled with explicit fsync boundary; - clean shutdown/checkpoint evidence where applicable.
- [x] Prove logical data restoration after Machinen snapshot/restore: - strings; - hashes; - lists/streams where feasible; - TTL behavior if included in the support claim.
- [x] Record Redis provenance: - version; - architecture; - config digest; - RDB/AOF manifest digest; - workload digest; - verifier output digest.
- [x] Add stable refusals for: - active client session that must survive restore; - pub/sub subscriptions; - in-flight blocking commands; - dirty AOF without fsync boundary; - replication state; - module/native extension state; - host-mounted data dir ambiguity.
- [x] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only continuation.

## Validation

- [x] Redis clean/quiesced restore smoke.
- [x] Redis unsafe-neighbor refusal matrix.
- [x] Redis proof matrix preset.
- [x] Relevant static checks from Goal 44.

## Completion criteria

Complete when Redis has a verified clean/quiesced restore subset and all unsafe
neighbors are stable refusals.
