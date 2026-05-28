# Goal: Portable snapshot ladder focus — reach Level 4/5

## Objective

Make Machinen's portable snapshot roadmap, product claims, and engineering
discussions center on the portable snapshot ladder, with the strategic target of
Level 4 and Level 5 support.

Level 3 is a stop gap. Treat Level 3 runtime-aware continuation as technical debt
unless it is clearly marked as a temporary bridge toward Level 4 kernel-resource
reconstruction or Level 5 cross-architecture process continuation.

## Ladder

| Level | Implementation level value                | Meaning                                                                          | Desired status                     |
| ----: | ----------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
|     0 | `level-0-fail-closed-discovery`           | Detect unsupported state and refuse safely.                                      | Required guardrail                 |
|     1 | `level-1-semantic-restart`                | Restart an equivalent target-native workload.                                    | Product baseline, not the end goal |
|     2 | `level-2-semantic-continuation`           | Carry selected logical state through explicit descriptors.                       | Useful product subset              |
|     3 | `level-3-runtime-aware-continuation`      | Runtime-specific safe-point capture and replay.                                  | Technical debt / transition path   |
|     4 | `level-4-kernel-resource-reconstruction`  | Recreate/replay kernel resources from explicit descriptors.                      | Primary target                     |
|     5 | `level-5-cross-arch-process-continuation` | Translate live process execution state across ISAs without source-ISA emulation. | Primary target                     |

## Current support map

| Workload / area                                                           | Product support       | Current implementation level | Graduation target | Notes                                                                                                                   |
| ------------------------------------------------------------------------- | --------------------- | ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Node clean HTTP service                                                   | Supported             | Level 1                      | Level 4/5 later   | `node-http-clean-root-v1`; semantic restart through public `machinen snapshot` / `machinen restore`.                    |
| Python clean HTTP service                                                 | Supported             | Level 1                      | Level 4/5 later   | `python-http-clean-root-v1`; semantic restart.                                                                          |
| Go static clean HTTP service                                              | Supported             | Level 1                      | Level 4/5 later   | `go-http-clean-root-v1`; cgo/dynamic linkage remains refused.                                                           |
| Ping sequence/counter                                                     | Supported             | Level 2                      | Level 4 ping fd   | `ping-sequence-counter-semantic-continuation-v1`; logical descriptor continuation, not raw socket/process continuation. |
| Live Node process continuation proofs                                     | Not yet supported     | Not implemented              | Level 5           | Strong proof evidence exists, but not product support unless routed through public product verbs.                       |
| Already-running Node process proofs                                       | Not yet supported     | Not implemented              | Level 5           | Claimed subset proof with unsafe neighbors refused.                                                                     |
| Node production/expanded/ecosystem envelopes outside clean-service subset | Not yet supported     | Not implemented              | Level 4/5         | Treat as temporary technical debt unless moved toward Level 4/5.                                                        |
| JVM / Ruby / non-product Python runtime envelopes                         | Not yet / unsupported | Not implemented / Level 0    | Level 4/5         | JVM process checkpoint currently has explicit refusal when runtime/profile is unavailable or unsafe.                    |
| Go quiescent runtime proofs                                               | Not yet supported     | Not implemented              | Level 4/5         | Runtime-aware proof; not arbitrary goroutine/process continuation.                                                      |
| PostgreSQL logical restore                                                | Not yet supported     | Not implemented              | Level 3 bridge    | Strong logical restore proof; not public no-extra-flag product support yet.                                             |
| Redis / SQLite / MySQL / queues / filesystem-backed stateful services     | Not yet / unsupported | Not implemented / Level 0    | Level 3/4 bridge  | Workload-aware matrices; unsafe states refused.                                                                         |
| Native register/stack/memory/code/loader proofs                           | Not yet supported     | Not implemented              | Level 5           | Native/process proof rows must stay proof unless productized through public verbs.                                      |
| TLS/SIMD/FPU/signal/active syscall/thread/resource/mapping policies       | Unsupported           | Level 0                      | Level 5           | These are Level 4/5 blockers and should become explicit descriptor/reconstruction work, not hidden runtime debt.        |
| Arbitrary Linux process-image continuation                                | Unsupported           | Level 0                      | Selected subsets  | No product claim until selected subsets have explicit descriptors, refusals, and target-native validation.              |

## Discussion rules

1. Always state both `productSupport` and `implementationLevel`.
2. Do not treat `migrationCompleted=true` as product support.
3. Do not count source-ISA emulation, sidecar output, metadata-only success, or raw cross-ISA checkpoint replay as product success.
4. Treat Level 3 rows as debt unless they include an explicit path to Level 4 or Level 5.
5. Prefer Level 4 descriptors for kernel resources and Level 5 native/process translation over runtime-specific shortcuts.
6. Refusal rows must remain stable, fail-closed, and `migrationCompleted=false`.

## Next work

- Build a first-class Level 4 inventory: sockets, epoll, eventfd, timerfd, signalfd, pipes, ptys, credentials, namespaces, queues, readiness, and partial transfer state.
- For each runtime/workload row, mark whether it is:
  - already Level 4/5 relevant;
  - Level 3 debt with a migration path;
  - supported Level 1/2 by design;
  - stable Level 0 refusal.
- Convert native/process proof evidence into checked gauntlet rows without implying product support.
- Define what must be true for Node, JVM, Go, Python, databases, and ping to graduate toward Level 4/5.
