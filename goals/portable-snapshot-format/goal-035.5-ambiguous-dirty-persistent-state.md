# Goal 35.5: Ambiguous dirty persistent state

Parent: [Goal 35](./goal-035.md).

## Objective

Resolve the remaining dirty persistent state gap for Node.js apps: open files,
append logs, mmap state, database transactions, file locks, fsync gaps, external
stores, and host-visible durability ambiguity.

## Requirements

- [x] Add dirty-state fixtures for open write streams, append logs, mmap-backed
      data, SQLite or equivalent transactions, file locks, fsync gaps, temp-file
      rename patterns, and external store clients.
- [x] Define a durability model for each supported class: what bytes are
      captured, what bytes must already be durable, and what happens to pending
      buffered writes.
- [x] Restore supported dirty state and verify post-restore data integrity with
      checksums and application-level queries.
- [x] Refuse ambiguous states with stable codes when host/kernel/app durability
      cannot be proven.
- [x] Prove no duplicate writes, lost acknowledged writes, or reordered durable
      events for supported cases.
- [x] Add checked summaries and docs explaining the user-visible persistence
      contract.

## Validation

- [x] Dirty file/write-stream restore smoke.
- [x] Log append and temp-file rename restore smoke.
- [x] SQLite/equivalent transaction integrity smoke.
- [x] mmap, lock, fsync-gap, and external-store refusal matrix unless supported.
- [x] Data-integrity diff and checksum audit.
- [x] Relevant static checks from Goal 35.

## Completion criteria

Complete when dirty persistent state has explicit restore semantics for the
claimed subset and all ambiguous durability states fail closed.

## Completion note

Completed as part of umbrella Goal 35. See
[Goal 35 completion validation record](./goal-035.md#completion-validation-record)
for implementation and validation evidence.
