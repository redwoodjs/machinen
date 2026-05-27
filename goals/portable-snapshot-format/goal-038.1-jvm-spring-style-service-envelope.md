# Goal 38.1: JVM/Spring-style service envelope

Parent: [Goal 38](./goal-038.md).

## Objective

Evaluate a JVM/Spring-style service restore envelope with managed heap, JIT,
classloader/module graph, threads, TLS, JDBC-style persistence, and JNI/native
boundaries.

## Requirements

- [x] Add an audited local JVM service fixture or equivalent Spring-style service
      model with HTTP routes, dependency-injection-like initialization, config,
      thread pools, persistence, and TLS policy.
- [x] Record Java/JVM vendor, version, architecture, classpath/module graph,
      loaded classes, JIT/code-cache policy, GC/heap policy, and thread states.
- [x] Support or refuse classloader graph drift, reflection/dynamic proxy state,
      monitor/lock state, parked threads, JIT code cache, JNI/native library
      state, and JDBC connection/session state.
- [x] Prove target-native restore for supported subsets or stable refusal with
      `migrationCompleted=false`.
- [x] Cover JVM version/vendor matrix at least enough to define the first support
      or refusal boundary.

## Validation

- [x] JVM/Spring-style support-or-refusal smoke.
- [x] JVM unsafe-neighbor refusal matrix.
- [x] Runtime manifest and checked summaries.
- [x] Shortcut/security inspection.
- [x] Relevant static checks from Goal 38.

## Completion criteria

Complete when JVM/Spring-style app behavior is either proven for a concrete
subset or fail-closed with stable managed-runtime/JNI/JDBC refusal codes.

## Completion record

Completed with `scripts/non-node-runtime-proof.mjs`, `scripts/smoke/non-node-runtime-proof.sh`, non-Node checked summaries, runtime manifest updates, proof profiles, matrix presets, and user guidance in `docs/snapshot/non-node-runtime-restore-claims.md`. Final validation passed on 2026-05-25.
