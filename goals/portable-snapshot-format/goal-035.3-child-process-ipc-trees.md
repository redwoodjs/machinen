# Goal 35.3: Child process and IPC trees

Parent: [Goal 35](./goal-035.md).

## Objective

Prove restore behavior for Node.js processes that own child processes, stdio
pipes, IPC channels, process groups, and lifecycle relationships.

## Requirements

- [x] Add fixtures for `child_process.spawn`, `fork`, stdio pipes, IPC messages,
      detached children, process groups, and child exit/restart races.
- [x] Capture parent/child process topology, argv/env/cwd, pid relationship
      metadata, pipe buffers, IPC messages, signal disposition, and wait status.
- [x] Restore supported parent/child trees with no orphaned child processes and
      no duplicated side effects.
- [x] Prove post-restore IPC message exchange and stdio continuity for supported
      cases.
- [x] Refuse unsafe neighbors: unknown child executable, uncheckpointable child
      state, active exec replacement, detached process groups outside the restore
      boundary, ambiguous pending IPC, and host-resource leaks.
- [x] Add stable refusal codes and checked summaries for every unsupported
      process-tree class.

## Validation

- [x] Child process restore smoke.
- [x] IPC continuity smoke.
- [x] Stdio pipe preservation tests.
- [x] Process-tree refusal matrix.
- [x] Leak/orphan audit after restore and after refusal.
- [x] Relevant static checks from Goal 35.

## Completion criteria

Complete when supported Node child-process and IPC trees restore
cross-architecture without orphaned resources, and unsupported trees fail closed
with stable codes.

## Completion note

Completed as part of umbrella Goal 35. See
[Goal 35 completion validation record](./goal-035.md#completion-validation-record)
for implementation and validation evidence.
