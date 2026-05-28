# Architecture-portable snapshot restore goals

This directory tracks the progressive path from safe semantic restore toward an
architecture-portable snapshot experience.

North star:

> Every user-visible discontinuity must be preserved, resolved with defined
> semantics, or refused with clear remediation.

`FINAL-GOAL.md` is the final proof-gauntlet definition. The numbered goals below
break that final goal into reviewable steps.

## Goal index

| Goal                                                             | Title                                                     | Final-goal section                                     | Level                           | Purpose                                                                                                                       | Key deliverables                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [`001`](./001.md)                                                | Architecture-portable snapshot seamless restore roadmap   | Roadmap                                                | Roadmap                         | Define the product ladder and state vocabulary for architecture-portable snapshot restore.                                    | Support ladder, state vocabulary, ping teaching case, milestones.                                                                |
| [`002`](./002-opposite-isa-vm-execution.md)                      | Opposite-ISA VM execution proof                           | 1. Opposite-ISA VM execution                           | Foundation                      | Prove guest ISA can differ from host ISA and that proof output comes from inside the guest.                                   | `amd64` guest on `arm64`, `arm64` guest on `amd64` where available, provider/emulation labeling, guest ELF verifier.             |
| [`003`](./003-stateful-database-portable-restore.md)             | Stateful database portable restore proof                  | 2. Stateful databases                                  | Level 2 semantic continuation   | Prove PostgreSQL and SQLite move cross-architecture through explicit logical/checkpoint state and target-native verification. | PostgreSQL bidirectional logical restore/refusals, SQLite rollback/WAL restore/refusals, database digests and checked summaries. |
| [`004`](./004-guest-checkpoint-substrate.md)                     | Guest checkpoint substrate proof                          | 3. Guest checkpoint substrate                          | Same-guest checkpoint substrate | Prove the guest Linux surface supports scoped in-guest checkpointing for ordinary workloads, or refuses clearly.              | Scoped checkpoint probe, C checkpoint/restore, JVM checkpoint/restore-or-refusal, checkpoint tool version/log summaries.         |
| [`005`](./005-portable-snapshot-guest-checkpoint-composition.md) | Portable snapshot plus guest checkpoint composition proof | 4. Portable snapshot plus guest checkpoint composition | Composition                     | Prove Machinen snapshot/restore and in-guest checkpoint do not break each other.                                              | Guest checkpoint before/after Machinen restore, stored checkpoint image readability, no cross-ISA checkpoint replay claim.       |
| [`006`](./006-c-java-runtime-confidence.md)                      | C and Java runtime confidence profiles                    | 5. C and Java runtime confidence                       | Runtime confidence              | Classify non-toy C and JVM profiles as product-supported, proof-only, stretch, or refused.                                    | C static/dynamic/file/timer/signal/TCP profiles, JVM loop/service profile, honest runtime/native refusals.                       |
| [`007`](./007-advanced-linux-facility-probes.md)                 | Advanced Linux facility probes                            | 6. Advanced Linux facility probes                      | High-signal kernel probes       | Prove or clearly refuse seccomp, eBPF, namespaces, cgroups, and capabilities.                                                 | Facility probe matrix, capability/kernel requirements, stable refusals for unavailable/unsafe state.                             |
| [`008`](./008-nested-virtualization-stretch-proof.md)            | Nested virtualization stretch proof                       | 7. Nested virtualization stretch proof                 | Stretch/demo                    | Demonstrate nested virtualization only where available and keep it out of product claims unless safe.                         | Availability probe, stretch smoke, L0/L1/L2 arch labels, snapshot/fork refusal while nested virt is active.                      |
| [`009`](./009-final-proof-gauntlet-checked-summary.md)           | Final proof gauntlet checked summary                      | Required output + completion criteria                  | Aggregation                     | Aggregate all proof rows into one machine-readable checked summary and enforce global invariants.                             | Row schema, final checked summary, invariant tests, full gauntlet runner.                                                        |

## Recommended implementation order

1. [`002`](./002-opposite-isa-vm-execution.md) — prove the host/guest architecture
   matrix and labeling first.
2. [`003`](./003-stateful-database-portable-restore.md) — PostgreSQL/SQLite are
   the most credible Level 2 semantic continuation examples.
3. [`004`](./004-guest-checkpoint-substrate.md) — prove same-guest checkpoint substrate.
4. [`005`](./005-portable-snapshot-guest-checkpoint-composition.md) — prove Machinen and
   guest checkpoint layers compose.
5. [`006`](./006-c-java-runtime-confidence.md) — expand beyond toy commands.
6. [`007`](./007-advanced-linux-facility-probes.md) — stress advanced kernel
   surfaces.
7. [`008`](./008-nested-virtualization-stretch-proof.md) — keep this clearly
   labeled as stretch/demo.
8. [`009`](./009-final-proof-gauntlet-checked-summary.md) — aggregate everything
   into the final proof suite.

## Where PostgreSQL fits

PostgreSQL belongs in [`003`](./003-stateful-database-portable-restore.md). It is
not live process teleportation and not clean-service restart. It is **Level 2
semantic continuation**: durable logical state is captured, restored
cross-architecture, and verified target-natively, while active transactions,
dirty WAL, physical byte-copy, host-mounted data directories, and verifier
mismatches are refused.
