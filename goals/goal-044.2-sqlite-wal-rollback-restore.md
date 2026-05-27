# Goal 44.2: SQLite WAL and rollback journal restore

Parent: [Goal 44](./goal-044.md).

## Objective

Prove SQLite database restore for clean rollback-journal and WAL/checkpoint
states, and refuse unsafe transactional or filesystem states.

## Requirements

- [ ] Add audited SQLite fixtures with schema, seed data, workload, and verifier.
- [ ] Prove rollback-journal mode clean restore.
- [ ] Prove WAL mode clean checkpoint restore.
- [ ] Verify indexes, constraints, transactions committed before snapshot, and
      deterministic query output after restore.
- [ ] Record provenance: - SQLite version; - database mode; - schema digest; - workload digest; - database/WAL/journal manifest digest; - verifier output digest.
- [ ] Add stable refusals for: - active transaction; - hot WAL without checkpoint boundary; - hot rollback journal; - database lock held across snapshot; - mmap-backed state ambiguity; - unsynced data file; - host-mounted DB file ambiguity.
- [ ] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only continuation.

## Validation

- [ ] SQLite rollback-journal restore smoke.
- [ ] SQLite WAL checkpoint restore smoke.
- [ ] SQLite unsafe-neighbor refusal matrix.
- [ ] SQLite proof matrix preset.
- [ ] Relevant static checks from Goal 44.

## Completion criteria

Complete when SQLite has verified clean restore for rollback-journal and WAL
checkpoint states, with stable refusals for unsafe neighbors.
