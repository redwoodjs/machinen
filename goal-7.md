# Goal 7: application-neutral foundation hardening

Goal 6 graduated one narrow success subset from each proven refusal frontier. The
next phase is not Node-specific, Python-specific, or tied to any one runtime. It
is the foundation work needed before we can responsibly claim support for more
real applications.

The eventual target is an app-neutral support contract:

```text
arm64 process/app state -> portable machine snapshot -> amd64 VM restore
```

A runtime or application family can be supported only when its state is expressed
as portable capabilities, restored with target-native recipes, verified by target
gates, and bounded by exact refusal codes. Unsafe or ambiguous state must keep
failing closed.

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

Goal 6 leaves the proof inventory at:

- 11 `baseline-success` profiles;
- 10 `graduated-support` profiles;
- 32 `intentional-refusal` profiles;
- 3 `permanent-refusal` profiles.

Goal 7 should preserve those counts unless a track intentionally adds a new
profile or graduates a new subset with the full support-claim checklist.

## Automation rules

- Base each implementation task on `portable-snapshots`.
- Use one issue, one branch, and one PR per task.
- Prefer app-neutral capability work over runtime-specific support claims.
- Do not mark any app/runtime family supported by docs alone.
- A new support claim still requires:
  - portable state model;
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

- `[ ]` todo.
- `[x]` complete and merged.
- `[!]` permanent or intentionally refused invariant.
- `[~]` partial implementation exists but is not yet a supported success claim.

## Track 1: current support envelope and contract

Goal: make the current support boundary understandable without reading every
proof profile.

Tasks:

- [ ] Add an app-neutral support-envelope doc that explains what is supported
      today, what is refused, and what is permanent refusal.
- [ ] Summarize the accepted capability families from all baseline and graduated
      profiles: regular files, pipe pairs, eventfd/timerfd, readiness wait,
      signal mask, process context, private memory, threads, and active syscalls.
- [ ] Summarize the refusal families that remain: sockets, active TCP
      connections, futex/rseq, shared memory, epoll wait graphs, pending signals,
      restart ambiguity, native addons/opaque runtime state, and raw cross-ISA
      vmstate replay.
- [ ] Clarify Goal 6 wording for readiness waits: blocked-mask-only signal
      support graduated, but signal-mask-changing `ppoll`/wait semantics remain
      refused until their own verifier and ordering contract exists.
- [ ] Document the difference between portable machine restore, native process
      restore, runtime-level state restore, and application-specific hooks, which
      remain disallowed as success.
- [ ] Add a short "how to read a refusal" section: exact code,
      `migrationCompleted=false`, `descriptorGateCompleted=false` when the
      descriptor cannot be safely accepted, and no accidental target success.

Done when a contributor can inspect one doc and know whether a new app state is
already supported, needs a support graduation, or must refuse.

## Track 2: one-command proof matrices

Goal: make the proof ladder reproducible without hand-written shell loops.

Tasks:

- [ ] Add a matrix runner command that can run profiles by `supportStatus`, by
      capability, by unsafe family, or by explicit profile list.
- [ ] Add first-class matrix presets for baseline success, graduated support,
      all positive profiles, the refusal matrix, and the Goal 6/7 full
      foundation matrix.
- [ ] Emit one summary JSON containing profile counts, pass/fail state, timings,
      workdirs, refusal codes, target gates, and remote host details.
- [ ] Make refusal matrices verify the full fail-closed contract:
      `migrationCompleted=false`, exact refusal code, no source text replay, no
      source-ISA emulation, and no sidecar success path.
- [ ] Make positive matrices verify the full success contract:
      `migrationCompleted=true`, `descriptorGateCompleted=true`, target-native
      completion, and every expected gate passed.
- [ ] Add tests for matrix selection, summary shape, mixed pass/fail output, and
      refusal-code drift.
- [ ] Document the exact command lines and expected output for local synthetic
      refusal runs and remote arm64->amd64 target-native runs.

Done when the final validation matrix used in goal files can be recreated with a
single command and a stable JSON artifact.

## Track 3: target-native provenance hardening

Goal: make it impossible to mistake an emulated, sidecar, stale, or wrong-ISA
restore path for native-transparent success.

Tasks:

- [ ] Record target guest architecture, kernel path/hash, rootfs path/hash, VMM
      path/hash, target init hash, target exec-agent hash, and tool versions in
      proof summaries.
- [ ] Fail closed if the amd64 remote VMM is not a Linux x86_64 executable.
- [ ] Fail closed if target guest `init` or `exec-agent` is missing, stale, or not
      x86_64 for amd64 target proofs.
- [ ] Record target continuation bytes hash and restore descriptor hash in every
      target-native proof summary.
- [ ] Record target executable/module provenance for real utility continuations.
- [ ] Add a remote preflight that checks the expected PATH/toolchain and reports
      precise failure causes instead of allowing ambiguous proof failure.
- [ ] Add tests or dry-run fixtures for wrong-arch VMM, wrong-arch guest helper,
      missing kernel/rootfs, and stale remote repo paths.

Done when remote arm64->amd64 proofs produce enough provenance to audit that the
success path was truly target-native.

## Track 4: capability inventory and profile schema

Goal: make profiles describe app-neutral capabilities instead of only profile
names.

Tasks:

- [ ] Add a `capabilities` field to proof profiles for accepted state families
      such as `fd:regular-file`, `fd:eventfd`, `wait:poll`, `memory:private-rw`,
      `signal:blocked-mask`, `process:target-auxv`, and `thread:controlled`.
- [ ] Add a `refusesCapabilities` or equivalent field for refusal profiles so
      unsupported app states can be mapped to exact refusal codes.
- [ ] Add schema validation for profile fields required by each `supportStatus`:
      accepted subset, old refusal code, unsafe variants, capabilities, expected
      gates, and graduation requirements.
- [ ] Generate a capability summary from `scripts/portable-machine-proof-profiles.json`.
- [ ] Add tests that every graduated profile has nearby unsafe variants and every
      unsafe variant resolves to a runnable refusal profile.
- [ ] Add docs showing how a future Node/Python/Go/JVM support claim maps its
      runtime state to app-neutral capabilities before any runtime-specific work
      starts.

Done when app/runtime planning can start by asking "which capabilities does this
state require?" instead of searching profile names manually.

## Track 5: runtime-neutral adapter boundary

Goal: prepare for Node, Python, Go, JVM, Ruby, and other runtimes without making
Node-specific assumptions.

A runtime adapter may be useful, but it must not weaken the native-transparent
success contract. Runtime adapters can describe portable semantic state. They
cannot make success depend on source-ISA execution, app hooks, target sidecars, or
source text replay.

Tasks:

- [ ] Define a runtime-neutral adapter boundary with runtime/build identity,
      portable semantic state sections, native resource requirements,
      target-native restore requirements, and refusal codes for opaque or unsafe
      runtime state.
- [ ] Define common runtime state classes: heap graph, pending timers, async
      continuations, module/build identity, native handles, worker/thread state,
      and opaque native extension state.
- [ ] Define mandatory refusal cases for runtime adapters: unknown native
      addon/extension state, active target-opaque VM/JIT frames, source-owned
      executable/JIT code, active sockets without a transport contract, worker
      threads without a synchronization model, and app hooks required for
      correctness.
- [ ] Add a no-op/sample runtime adapter fixture that proves schema and refusal
      behavior without claiming support for a real runtime.
- [ ] Document how a future Node runtime track would consume the adapter boundary
      after the app-neutral proof infrastructure exists.

Done when runtime-specific goals can be written as consumers of a shared adapter
contract instead of inventing their own success/refusal semantics.

## Track 6: shared resource backlog for real apps

Goal: keep the universal real-app blockers visible and prioritized.

High-priority future support graduations:

- [ ] listening TCP sockets with no active accepted connections;
- [ ] active TCP connections with an explicit broker/transport contract;
- [ ] epoll wait graphs without cycles and with target-verified readiness;
- [ ] `ppoll`/wait signal-mask changes with deterministic final mask semantics;
- [ ] deterministic `EINTR` for one active syscall with exact remaining-time
      contract;
- [ ] multiple private anonymous memory ranges with guard-page verification;
- [ ] file-backed private mappings with exact provenance and permissions;
- [ ] cwd/root/env/argv/auxv expansion beyond target-owned `AT_RANDOM`;
- [ ] file locks/leases/async notification or stable refusals for each;
- [ ] futex wait/wake and rseq lifecycle only after exact synchronization and TLS
      ownership models exist.

Refusal boundaries that remain until explicitly graduated:

- [!] sockets and active network connections without a transport contract;
- [!] futex/rseq and scheduler-visible synchronization;
- [!] shared memory without a target sharing contract;
- [!] active signal frames, pending signals, alt-stacks, and ambiguous restarts;
- [!] source vDSO/vvar reuse and raw cross-ISA vmstate replay;
- [!] executable/JIT/self-modifying code without target-native regeneration;
- [!] runtime native extension/addon state without a portable model.

## Cross-goal completion criteria

Goal 7 is complete only when:

- [ ] the current support envelope is documented and app-neutral;
- [ ] proof matrices are runnable with one command and stable JSON output;
- [ ] target-native provenance checks fail closed for wrong or ambiguous remote
      proof environments;
- [ ] every proof profile is mapped to supported/refused capabilities;
- [ ] runtime adapter boundaries are defined without claiming support for any one
      runtime;
- [ ] Goal 3/4/6 graduated profiles still pass remotely;
- [ ] the original positive matrix still passes remotely;
- [ ] the full refusal matrix still passes;
- [ ] no new path uses source-ISA emulation, sidecar runtime success, app hooks,
      or source text replay;
- [ ] validation timings are recorded for every completed task.
