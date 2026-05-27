# Goal 36.2: Real persistence systems

Parent: [Goal 36](./goal-036.md).

## Objective

Expand persistence proof from local JSONL-style state to real application data
systems and explicit durability/refusal semantics.

## Requirements

- [x] Add SQLite WAL fixture with committed transactions, checkpoint boundaries,
      locks, and an open connection at capture time.
- [x] Add Postgres client-pool fixture with in-flight query/refusal boundaries,
      reconnect policy, session state, prepared statements, and transaction
      state handling.
- [x] Add Redis client fixture with reconnect policy, pub/sub or stream state,
      pending command boundaries, and key/value verification.
- [x] Define supported durability contracts for acknowledged writes, fsync/WAL
      semantics, open transactions, locks, temp files, and external service
      reconnection.
- [x] Refuse ambiguous external durability, uncommitted transaction state, held
      locks that cannot be recreated, unavailable target service identity, and
      unknown replication/failover state.
- [x] Verify no lost acknowledged writes, duplicate writes, or reordered durable
      events.

## Validation

- [x] SQLite WAL restore/refusal smoke.
- [x] Postgres client-pool restore/refusal smoke.
- [x] Redis client-state restore/refusal smoke.
- [x] Data integrity checksum/query audit.
- [x] Persistence checked summaries and matrix presets.
- [x] Relevant static checks from Goal 36.

## Completion criteria

Complete when real persistence systems have proof-backed supported subsets and
stable fail-closed semantics for ambiguous durability states.

## Completion note

Completed as part of umbrella Goal 36. See
[Goal 36 completion validation record](./goal-036.md#completion-validation-record)
for implementation and validation evidence.
