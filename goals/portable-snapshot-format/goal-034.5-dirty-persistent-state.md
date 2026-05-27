# Goal 34.5: Dirty persistent state semantics

Parent: [Goal 34](./goal-034.md).

## Objective

Prove dirty persistent state semantics for Node apps across capture and restore,
including open files, logs, and SQLite-style local database state.

## Requirements

- [x] Add a workload with an open file descriptor and pending/dirty writes.
- [x] Add a workload with append-only log state.
- [x] Add a SQLite or equivalent durable local database workload.
- [x] Capture while state is dirty or recently written.
- [x] Restore on Proxmox amd64.
- [x] Verify post-restore file/log/database contents and durability semantics.
- [x] Record file identity, offsets, fsync/durability policy, and descriptor
      provenance.
- [x] Refuse ambiguous dirty state with a stable code.

## Validation

- [x] Dirty persistent state restore smoke.
- [x] File identity drift refusal test.
- [x] Dirty-state ambiguity refusal test.
- [x] Checked summaries for both source routes.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when open file/log/database semantics are verified after restore or
ambiguous states fail closed with stable refusal codes.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
