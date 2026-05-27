# Goal 36.4: Cluster, worker, and supervisor process topology

Parent: [Goal 36](./goal-036.md).

## Objective

Prove restore behavior for Node apps with multiple workers and external
supervision patterns.

## Requirements

- [x] Add Node `cluster` fixture with multiple workers, shared listening socket,
      worker lifecycle state, and request distribution evidence.
- [x] Add worker-thread/process hybrid fixture with message channels and
      backpressure boundaries.
- [x] Add PM2/systemd-like supervisor fixture or faithful local equivalent with
      restart policy, health checks, and process group handling.
- [x] Capture and restore supported topology state without orphaned processes,
      duplicate workers, leaked sockets, or lost IPC messages.
- [x] Refuse detached process groups outside the restore boundary, supervisor
      state that cannot be reconciled, active worker replacement races,
      ambiguous shared sockets, and unknown child executable provenance.
- [x] Audit process tables and open resources after restore and refusal.

## Validation

- [x] Cluster restore/refusal smoke.
- [x] Worker-thread/process hybrid smoke.
- [x] Supervisor topology smoke.
- [x] Orphan/leak/resource audit.
- [x] Topology checked summaries and matrix presets.
- [x] Relevant static checks from Goal 36.

## Completion criteria

Complete when supported cluster/worker/supervisor topologies restore without
resource leaks and unsupported topologies fail closed.

## Completion note

Completed as part of umbrella Goal 36. See
[Goal 36 completion validation record](./goal-036.md#completion-validation-record)
for implementation and validation evidence.
