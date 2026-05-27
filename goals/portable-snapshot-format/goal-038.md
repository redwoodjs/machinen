# Goal 38: Non-Node complex runtime portable restore exploration

Parent context: Goals 34-37 built a proof-backed Node.js portable restore envelope
from curated fixtures through complex, no-third-party-install ecosystem-equivalent
apps. Goal 38 starts the same style of cautious, proof-backed exploration for
other complicated runtimes.

## Objective

Evaluate and prove, or fail closed with stable refusal codes, portable
snapshot/restore behavior for complex non-Node application runtimes. The goal is
not to make broad unsupported claims; it is to establish concrete envelopes for
JVM, Python, Ruby, and Go-style applications using audited local fixtures and
clear target-native proof requirements.

## Phased subgoals

Complete these linked subgoals before marking the umbrella Goal 38 complete:

- [x] [Goal 38.1: JVM/Spring-style service envelope](./goal-038.1-jvm-spring-style-service-envelope.md)
      — prove or refuse JVM service restore with HTTP, classpath/module graph,
      thread pools, JDBC-style persistence, TLS, JIT/classloader/JNI boundaries,
      and vendor/version matrix.
- [x] [Goal 38.2: Python Django/Celery-style envelope](./goal-038.2-python-django-celery-style-envelope.md)
      — prove or refuse Python web/worker restore with virtualenv/site-packages,
      import graph, ORM/database-style persistence, async tasks, and C-extension
      boundaries.
- [x] [Goal 38.3: Ruby Rails/Puma-style envelope](./goal-038.3-ruby-rails-puma-style-envelope.md)
      — prove or refuse Ruby app restore with autoloading, gems/native
      extensions, threaded Puma-style workers, ActiveRecord-style persistence,
      and Bootsnap/cache boundaries.
- [x] [Goal 38.4: Go service/runtime envelope](./goal-038.4-go-service-runtime-envelope.md)
      — prove or refuse Go service restore with goroutines, netpoller, TLS,
      static vs dynamic binaries, cgo boundaries, and scheduler state.
- [x] [Goal 38.5: Cross-runtime comparison matrix and user guidance](./goal-038.5-cross-runtime-comparison-matrix-user-guidance.md)
      — publish a comparison matrix that explains supported subsets, refusal
      families, target-native requirements, and which runtime should be expanded
      next.

## Umbrella completion criteria

Goal 38 is complete only when every linked subgoal above is complete and the
final validation record proves:

- [x] each runtime has at least one audited local complex app fixture or a stable
      refusal explaining why the fixture cannot be supported yet;
- [x] target-native restore summaries explicitly reject source-ISA emulation,
      source text replay, sidecar runtimes, and app restore hooks;
- [x] managed-runtime hazards are represented: heap/GC/JIT/classloader/import
      graph/gem graph/goroutine scheduler as applicable;
- [x] native-extension/JNI/cgo/native-gem/C-extension boundaries are supported or
      refused with stable codes;
- [x] persistence/network/threading/concurrency state is covered as support or
      refusal for every runtime;
- [x] runtime manifests, proof profiles, checked summaries, docs, and user-facing
      guidance are updated;
- [x] full static checks, focused tests, live smokes where feasible, and relevant
      full smoke tests pass.

## Required final validation

Run and record timing for:

- [x] JVM/Spring-style support-or-refusal smoke;
- [x] Python Django/Celery-style support-or-refusal smoke;
- [x] Ruby Rails/Puma-style support-or-refusal smoke;
- [x] Go service support-or-refusal smoke;
- [x] cross-runtime comparison matrix;
- [x] full runtime support matrix;
- [x] full refusal matrix;
- [x] full foundation matrix;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` if VM,
      restore, CLI, rootfs, or live mount behavior changes.

## Completion record

Completed with `scripts/non-node-runtime-proof.mjs`, `scripts/smoke/non-node-runtime-proof.sh`, non-Node checked summaries, runtime manifest updates, proof profiles, matrix presets, and user guidance in `docs/snapshot/non-node-runtime-restore-claims.md`. Final validation passed on 2026-05-25.
