# Goal 44.4: MySQL/MariaDB clean restore

Parent: [Goal 44](./goal-044.md).

## Objective

Prove a clean/quiesced MySQL or MariaDB snapshot/restore subset inside Machinen
and define stable refusals for unsafe InnoDB and replication states.

## Requirements

- [ ] Choose MySQL or MariaDB based on the locally available Debian package and
      document the exact version.
- [ ] Add audited SQL fixtures with schema, seed data, workload, and verifier.
- [ ] Prove a clean InnoDB checkpointed restore path: - no active transaction; - dirty pages flushed or checkpointed; - redo/binlog boundary recorded; - target logical verifier passes.
- [ ] Record provenance: - server version; - architecture; - config digest; - SQL fixture/workload digests; - data directory manifest; - redo/binlog checkpoint evidence; - target verifier output digest.
- [ ] Add stable refusals for: - active transaction; - active client session; - dirty redo-log ambiguity; - binary log / replication state ambiguity; - plugin/native extension state; - torn or unsynced data directory; - host-mounted data directory ambiguity.
- [ ] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only continuation.

## Validation

- [ ] MySQL/MariaDB clean/quiesced restore smoke.
- [ ] MySQL/MariaDB unsafe-neighbor refusal matrix.
- [ ] MySQL/MariaDB proof matrix preset.
- [ ] Relevant static checks from Goal 44.

## Completion criteria

Complete when MySQL or MariaDB has a verified clean/quiesced restore subset and
stable refusals for unsafe neighbors.
