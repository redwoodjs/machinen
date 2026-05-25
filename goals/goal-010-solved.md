# Goal 10 solved substeps: runtime refusals without runtime shortcuts

This companion ledger turns Goal 10 into concrete runtime-adapter increments. The
main rule is that runtime work can only consume app-neutral capabilities already
proven by the foundation matrix. Runtime-specific state that cannot be expressed
that way must refuse.

## Solved subset 10.1: runtime support manifest and conformance matrix

Refusals addressed:

- runtime support by prose only;
- missing capability coverage;
- positive runtime claim without target-native proof;
- refusal-code drift for opaque runtime state.

Narrow success claim:

- no runtime family support yet; this is enforcement infrastructure.

Implementation substeps:

- [x] Add runtime support manifest schema with runtime/build identity, semantic
      sections, required capabilities, proof profile refs, expected gates,
      provenance requirements, and refusal codes.
- [x] Add capability resolver that reads the support envelope and proof profiles
      and rejects unknown or ungraduated required capabilities.
- [x] Add positive-claim validator requiring runnable app-neutral positive
      profiles for every required capability.
- [x] Add refusal validator requiring exact runtime refusal codes for opaque
      native extension, JIT/source-code, app-hook, socket, worker/thread, and VM
      frame states.
- [x] Add `runtime-support-matrix` command with stable JSON: manifest status,
      capability coverage, pass/fail state, gates, refusal codes, timings,
      workdirs, and provenance.
- [x] Add tests for schema shape, missing capability rejection, positive claim
      without proof rejection, refusal-code drift, mixed output, and summary
      stability.
- [x] Document runtime PR requirements.

Done when a runtime support claim is mechanically blocked unless its capabilities
are already graduated and proof-backed.

## Solved subset 10.2: Node planning fixture refusals

Refusals addressed:

- unknown native addon state;
- active V8/JIT/source-owned executable frames;
- source text replay;
- worker threads without sync model;
- active sockets without Goal 8/9 contracts;
- app hooks required for correctness.

Narrow success claim:

- planning-only unless a future positive Node subset passes target-native proof.

Implementation substeps:

- [x] Add Node manifest fixture with Node version/build id, target binary hash,
      module graph identity, event-loop handles, heap classification, workers,
      native addons, sockets, timers, and async continuations.
- [x] Map every Node handle/state class to app-neutral capabilities or exact
      runtime refusal codes.
- [x] Add refusal fixtures for native addons, JIT frames, source-owned executable
      code, source text replay, active sockets without contracts, worker threads
      without sync model, inspector/debug state, and app hooks.
- [x] Add tests proving all unsupported Node states produce
      `migrationCompleted=false` and no sidecar/source replay success.
- [x] If a minimal Node subset is later attempted, require a new positive profile
      `runtime-node-quiescent-minimal-recreate` plus nearby negative profiles;
      otherwise docs must state Node is planning-only and unsupported.
- [x] Record target Node executable/module provenance in matrix summaries.

Done when Node-specific planning exists and every unsupported Node state fails
closed with exact codes.

## Solved subset 10.3: Python planning fixture refusals

Refusals addressed:

- C extension/native state;
- active interpreter frames with target-opaque state;
- threads without synchronization model;
- active sockets without contracts;
- app hooks and source text replay.

Narrow success claim:

- planning-only unless a future positive Python subset passes target-native proof.

Implementation substeps:

- [x] Add Python manifest fixture with runtime/build identity, target binary hash,
      import/module graph identity, heap classification, thread state, signal
      handlers, timers, extension modules, sockets, and async state.
- [x] Map every Python state class to app-neutral capabilities or exact runtime
      refusal codes.
- [x] Add refusal fixtures for C extensions, opaque interpreter/native frames,
      threads without sync model, active sockets without contracts, app hooks,
      source text replay, and import/module mismatch.
- [x] Add tests proving unsupported Python states fail closed with exact codes.
- [x] If a minimal Python subset is later attempted, require a positive profile,
      target-native restore recipe, gates, and nearby negatives; otherwise docs
      must state Python is planning-only and unsupported.
- [x] Record target Python executable/module provenance in matrix summaries.

Done when Python planning is runtime-neutral and refusal-backed.

## Solved subset 10.4: Go/JVM/Ruby planning fixture refusals

Refusals addressed:

- runtime-adapter design biased toward one runtime;
- opaque scheduler/GC/JIT/native extension state;
- app hooks and source text replay.

Narrow success claim:

- planning-only fixtures across multiple runtime families.

Implementation substeps:

- [x] Add Go fixture mapping goroutines, scheduler state, netpoll, heap, timers,
      cgo, plugins, and OS threads to capabilities/refusals.
- [x] Add JVM fixture mapping heap, classpath/modules, code cache/JIT, JNI,
      threads, monitors, safepoints, and sockets to capabilities/refusals.
- [x] Add Ruby fixture mapping heap, fibers, GVL, native extensions, threads,
      timers, and sockets to capabilities/refusals.
- [x] Add tests that each fixture rejects ungraduated capabilities, opaque native
      code/state, app hooks, sidecar success, and source text replay.
- [x] Document common capability gaps that future runtime goals must close.

Done when the adapter contract is proven runtime-neutral without claiming support
for these runtimes.

## Solved subset 10.5: target-native runtime/module provenance

Refusals addressed:

- wrong-arch runtime binary;
- stale or missing runtime helper;
- target module graph mismatch;
- source text replay as target code;
- libc/loader mismatch.

Narrow success claim:

- provenance enforcement for any future runtime positive proof.

Implementation substeps:

- [x] Extend runtime matrix summaries with target runtime path/hash/build id,
      architecture, ABI, loader path/hash, libc identity, module/package hashes,
      tool versions, and remote host details.
- [x] Fail closed if target runtime, helper, loader, module, or libc is missing,
      stale, wrong-arch, or hash/build-id mismatched.
- [x] Add dry-run fixtures for wrong-arch runtime, stale module graph, missing
      target runtime, mismatched libc, missing loader, and source text replay.
- [x] Add tests proving provenance failures keep `migrationCompleted=false`.
- [x] Document how to audit runtime provenance from one matrix artifact.

Done when a reviewer can prove a runtime proof used the intended target-native
runtime and modules.

## Solved subset 10.6: app harness remains verification-only

Refusals addressed:

- app hooks as correctness path;
- arbitrary pre/post migration scripts;
- app-level source text replay;
- sidecar runtime success.

Narrow success claim:

- app harness can verify already-supported runtime subsets but cannot expand
  support.

Implementation substeps:

- [x] Add application harness schema with workload identity, runtime manifest,
      required app-neutral capabilities, inputs, expected target output, and
      refusal expectations.
- [x] Reject arbitrary pre/post migration hooks as correctness requirements.
- [x] Reject harnesses that require ungraduated capabilities or missing runtime
      positive profiles.
- [x] Add tests for app hooks, source-ISA execution, sidecar success, source text
      replay, and missing capability coverage.
- [x] Document how future real-app goals use the harness without changing the
      native-transparent support contract.

Done when real-app examples can validate already-supported subsets without
creating app-specific success semantics.

## Goal 10 solved completion checklist

- [x] Runtime manifest validation blocks ungraduated capabilities.
- [x] Runtime support matrix has stable JSON output.
- [x] Node and Python planning fixtures have exact refusal behavior.
- [x] Go/JVM/Ruby fixtures prove runtime neutrality.
- [x] Runtime provenance covers executable/module/build identity and wrong-arch
      failure.
- [x] App harness cannot use hooks, sidecars, source-ISA execution, or source text
      replay as success.
- [x] App-neutral foundation matrices still pass.
- [x] Validation timings are recorded.

## Validation timings

- `pnpm --silent runtime-support-matrix -- --json`: 0.189s, passed (5 planning-only runtime manifests and 1 verification-only app harness).
- `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries --json --continue-on-fail`: 3.025s, passed (131 profiles; golden summary gate-check matrix).
- Focused Vitest (`portable-machine-proof-runner`, `portable-machine-proof-matrix`, `runtime-support-matrix`, `runtime-adapter-fixture`): 3.775s, passed (86 tests).
- `pnpm run format:check`: 0.619s, passed.
- `pnpm run lint`: 0.208s, passed.
- `pnpm run build:docs`: 1.697s, passed.
- `pnpm run typecheck`: 2.830s, passed.
- `pnpm exec fallow audit --changed-since origin/main`: 0.432s, passed with one duplicate-import warning only.
- Full smoke tests skipped: no VM/VMM/rootfs/assets/CLI/snapshot/restore behavior was changed.
