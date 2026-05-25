# Goal 10: runtime onboarding without weakening native transparency

Goals 7-9 build the app-neutral capability ladder. Goal 10 is the first runtime
onboarding goal: create the machinery for runtime-specific support tracks to map
runtime state to app-neutral capabilities and either prove target-native restore
or fail closed. Goal 10 must not claim broad Node/Python/Go/JVM/Ruby support by
policy text alone.

The target remains:

```text
arm64 process/app state -> portable machine snapshot -> amd64 VM restore
```

A runtime family becomes supported only for a named, narrow subset whose state is
fully expressed by graduated app-neutral capabilities, restored by target-native
recipes, verified by target gates, and bounded by exact refusal profiles.

Concrete refusal-to-support substeps live in [`goal-10-solved.md`](./goal-10-solved.md).

## Baseline carried forward

The native-transparent success contract remains unchanged:

- target-native completion only;
- no source-ISA emulation as success;
- no Node/Bun/runtime sidecar as success;
- no app hooks;
- no captured source text reused as target code;
- `migrationCompleted=true` only after target-native completion and all required
  target gates pass;
- descriptor/resource gates must pass before completion;
- unsupported state refuses with a stable code and `migrationCompleted=false`.

Goal 10 starts from the Goal 9 inventory after Goal 9 is complete. If a runtime
fixture needs a capability that Goal 9 did not graduate, that fixture must refuse
or remain planning-only.

## Automation rules

- Base each implementation task on `portable-snapshots`.
- Use one issue, one branch, and one PR per runtime subset or adapter feature.
- Prefer app-neutral capability evidence over runtime-specific assumptions.
- Do not mark any runtime/application family supported by docs alone.
- A new runtime support claim requires:
  - runtime/build identity;
  - portable semantic state model;
  - mapping from semantic state to graduated app-neutral capabilities;
  - target-native restore recipe;
  - target gate/verifier evidence;
  - positive proof automation;
  - nearby negative tests/profiles;
  - docs and validation timings.
- Runtime adapters may describe portable state, but they are not a success path
  unless target-native restore and all gates complete without source-ISA
  emulation, sidecars, app hooks, or source text replay.
- Run full smoke tests whenever VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
  is touched.

## Status legend

- `[x]` todo.
- `[x]` complete and merged.
- `[!]` permanent or intentionally refused invariant.
- `[~]` partial implementation exists but is not yet a supported success claim.

## Track 1: runtime capability conformance suite

Goal: make runtime support claims mechanically depend on app-neutral capability
coverage instead of prose.

Tasks:

- [x] Define a runtime support manifest schema with runtime/build identity,
      semantic sections, required capabilities, target restore requirements,
      expected gates, and refusal codes.
- [x] Validate that every required capability is present in the support envelope
      or in a completed Goal 8/9 graduation.
- [x] Validate that every runtime positive claim references runnable positive
      proof profiles for each required app-neutral capability.
- [x] Validate that every opaque/unsafe runtime state references runnable refusal
      profiles or runtime-level refusal fixtures.
- [x] Add a `runtime-support-matrix` command that emits stable JSON with runtime
      manifest status, capability coverage, pass/fail state, gates, refusal
      codes, timings, workdirs, and provenance.
- [x] Add tests for schema shape, missing capability rejection, positive claim
      without proof rejection, refusal-code drift, mixed pass/fail output, and
      stable JSON summary shape.
- [x] Document how runtime tracks use the conformance suite before claiming
      support.

Done when a runtime-specific PR cannot accidentally claim support for a capability
that the app-neutral matrix has not graduated.

## Track 2: Node planning fixture and minimal non-JIT subset

Goal: turn the Goal 7 no-op adapter into a Node planning fixture and, only if all
required capabilities already exist, graduate one tiny Node subset without JIT,
native addons, active event-loop ambiguity, or app hooks.

Planning fixture requirements:

- Node runtime/build identity and target binary provenance;
- module/build identity for loaded JavaScript modules;
- heap/stack semantic state classification;
- event-loop handles mapped to app-neutral capabilities or exact refusals;
- native addon/JIT/inspector/worker state refused unless modeled;
- no source text replay as target code.

Potential first accepted subset, if prerequisites are met:

- a deterministic Node process stopped at a runtime-defined quiescent point;
- no native addons;
- no active JIT/source-owned executable frames;
- no worker threads;
- no active sockets unless Goal 8/9 socket contracts cover them;
- module identity is target-native and reproducible;
- target verifier proves target Node build identity and semantic output without
  app hooks.

Tasks:

- [x] Add Node runtime planning manifest and fixture that maps timers, fs fds,
      sockets, workers, native addons, modules, heap graph, and async
      continuations to capabilities/refusals.
- [x] Add tests that Node native addons, JIT frames, worker threads, active
      sockets without contracts, app hooks, and source text replay refuse with
      exact runtime refusal codes.
- [x] If the minimal subset is attempted, define its portable semantic model and
      target-native restore recipe.
- [x] If the minimal subset is attempted, add positive proof profile
      `runtime-node-quiescent-minimal-recreate` and nearby negative profiles.
- [x] Document exactly what is and is not Node-supported; if no positive proof is
      added, label the track planning-only and unsupported.
- [x] Run runtime-support matrix, app-neutral foundation matrix, focused Vitest,
      remote proof if positive, full smoke if restore behavior changed, and
      fallow audit.

Refusal boundaries that remain:

- [!] native addons/extension state without a portable model;
- [!] source-owned executable/JIT code;
- [!] active event-loop handles without app-neutral capability coverage;
- [!] app hooks required for correctness.

## Track 3: Python planning fixture and minimal interpreter subset

Goal: create the same support discipline for Python without inheriting
Node-specific assumptions.

Planning fixture requirements:

- CPython/PyPy runtime and build identity;
- module/import graph identity;
- heap object graph classification;
- pending signal/timer/thread state mapped to capabilities or refusals;
- C extension state refused unless modeled;
- no source text replay as target code.

Tasks:

- [x] Add Python runtime planning manifest and fixture mapping files, sockets,
      threads, signal handlers, extension modules, import state, and heap graph
      to capabilities/refusals.
- [x] Add tests that C extensions, active interpreter frames with opaque native
      state, threads without synchronization model, active sockets without
      contracts, app hooks, and source text replay refuse with exact runtime
      refusal codes.
- [x] If a minimal subset is attempted, define the portable semantic model,
      target-native restore recipe, target gates, positive profile, and nearby
      negative profiles.
- [x] Document exactly what is and is not Python-supported; if no positive proof
      is added, label the track planning-only and unsupported.
- [x] Run runtime-support matrix, app-neutral foundation matrix, focused Vitest,
      remote proof if positive, full smoke if restore behavior changed, and
      fallow audit.

Refusal boundaries that remain:

- [!] C extension/native state without a portable model;
- [!] active interpreter/JIT frames with target-opaque state;
- [!] app hooks required for correctness.

## Track 4: Go/JVM/Ruby planning fixtures

Goal: prove the adapter boundary is not biased toward one runtime by adding
planning fixtures for runtimes with different concurrency, GC, and native code
models.

Tasks:

- [x] Add Go planning fixture mapping goroutines, scheduler state, heap, timers,
      netpoll, cgo, plugins, and threads to capabilities/refusals.
- [x] Add JVM planning fixture mapping heap, class/module identity, JIT/code
      cache, JNI, threads, monitors, safepoints, and sockets to
      capabilities/refusals.
- [x] Add Ruby planning fixture mapping heap, fibers, native extensions, GVL,
      threads, timers, and sockets to capabilities/refusals.
- [x] Add tests that each fixture rejects unsupported capabilities, opaque native
      code, app hooks, and source text replay.
- [x] Document common capability gaps that future runtime goals must close before
      support claims.

Done when the runtime adapter contract is demonstrably runtime-neutral across
multiple runtime families, even if only planning fixtures exist.

## Track 5: target-native runtime binary and module provenance

Goal: make runtime proofs auditable for target-native executable identity, module
identity, and build compatibility.

Tasks:

- [x] Extend runtime support summaries with target runtime executable path/hash,
      build id, architecture, ABI, loader path, libc identity, and tool versions.
- [x] Record target module/package provenance for runtime module graphs without
      replaying source text as target code.
- [x] Fail closed if target runtime binary, helper, loader, module, or libc is
      missing, stale, wrong-arch, or hash/build-id mismatched.
- [x] Add dry-run fixtures for wrong-arch runtime, stale module graph, missing
      target runtime, mismatched libc, and source-text replay attempts.
- [x] Document how to audit runtime provenance from the runtime-support matrix
      artifact.

Done when a reviewer can prove from one artifact that a runtime proof used the
intended target-native runtime and modules.

## Track 6: application harness remains proof-only

Goal: allow real application smoke fixtures to exercise supported runtime subsets
without making application hooks part of correctness.

Tasks:

- [x] Add an application harness schema that declares workload identity, runtime
      manifest, required app-neutral capabilities, inputs, expected target output,
      and refusal expectations.
- [x] Ensure app harnesses cannot run arbitrary pre/post migration hooks as part
      of correctness.
- [x] Add positive harness support only for runtime subsets with target-native
      proof profiles; otherwise harnesses must be refusal or planning-only.
- [x] Add tests that app hooks, source text replay, source-ISA execution, and
      sidecar success are rejected.
- [x] Document how future real-app goals should use the harness without changing
      the native-transparent support contract.

Done when application-level examples can validate already-supported runtime
subsets without expanding the support boundary by accident.

## Cross-goal completion criteria

Goal 10 is complete only when:

- [x] runtime support manifests and runtime-support matrices exist with stable
      JSON output;
- [x] runtime support claims are mechanically blocked when required capabilities
      are not graduated;
- [x] Node and Python at least have planning fixtures with exact refusal behavior;
- [x] Go/JVM/Ruby planning fixtures prove the adapter boundary is runtime-neutral;
- [x] any runtime positive claim has a portable semantic model, target-native
      restore recipe, target gates, positive proof automation, nearby negative
      profiles, docs, and validation timings;
- [x] target-native runtime provenance records executable/module/build identity,
      architecture, hashes/build ids, tool versions, and remote host details;
- [x] app harnesses cannot use app hooks, source-ISA execution, sidecars, or
      source text replay as success;
- [x] Goal 3/4/6/7/8/9 graduated app-neutral profiles still pass remotely;
- [x] the original positive matrix still passes remotely;
- [x] the full refusal matrix still passes;
- [x] the full Goal 10 foundation/runtime matrix passes;
- [x] full smoke tests pass if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
      changed;
- [x] no new path uses source-ISA emulation, sidecar runtime success, app hooks,
      or source text replay;
- [x] validation timings are recorded for every completed task.
