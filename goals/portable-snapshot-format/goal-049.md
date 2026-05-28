# Goal 49: Generic clean-service product contract for cross-architecture restore

Parent context: Goal 47 proved the first real no-extra-flag product workflow for
a narrow Node HTTP subset through the existing commands:

```sh
machinen snapshot <name|pid> <bundle-dir>
machinen restore <bundle-dir>
```

Goal 48 tracks graduating ping, Go, Python, and other families individually.
Goal 49 defines the broader product abstraction those families should share: a
**generic clean-service contract**. The intent is to make Machinen useful for
many ordinary services without pretending to provide arbitrary live process,
VM-memory, kernel resource, runtime scheduler, interpreter-frame, or native-code
cross-ISA continuation.

Use Goal 47 as the reference shape for this goal: same product verbs, same
fail-closed posture, same target-native verification requirement, same refusal
semantics, and the same standard that proof fixtures / checked summaries / claim
registries are not product support by themselves.

## Problem statement

Goal 47's Node implementation proved the product workflow, but the implementation
shape is still too Node-specific. If every future language or service family gets
its own one-off portable bundle, Machinen will accumulate duplicated logic for:

- process/service discovery;
- argv/env/cwd/service-root capture;
- app/config/package provenance;
- verifier capture and target verification;
- target-native runtime installation/selection;
- refusal reporting;
- support-registry graduation.

The more sound product abstraction is a generic clean-service contract, with
runtime adapters only for the parts that are truly runtime-specific.

## Objective

Implement a generic cross-architecture clean-service product path through the
existing `machinen snapshot` and `machinen restore` commands. Machinen should
inspect a running VM, identify services that fit the clean-service contract,
capture safe semantic state, refuse unsafe or ambiguous state, restore the
service target-natively on the destination architecture, and verify behavior
before reporting `migrationCompleted=true`.

This goal is complete only when at least two runtime families use the shared
contract end-to-end, with Node retained as one implementation and at least one of
Python or Go added as a second implementation. Ping/network diagnostic state is
tracked as an optional third adapter here and remains a separate detailed family
in Goal 48 unless fully implemented under this contract.

## Subgoals

Goal 49 is intentionally split so the product contract can be reviewed and landed
incrementally without weakening the completion bar.

- [`goal-049.1-clean-service-contract.md`](./goal-049.1-clean-service-contract.md)
  — shared clean-service manifest, bundle schema, planner, refusal vocabulary,
  and support-registry rules.
- [`goal-049.2-node-clean-service-adapter.md`](./goal-049.2-node-clean-service-adapter.md)
  — refactor Goal 47's Node product path to use the shared contract without
  regressing bidirectional Node product restore.
- [`goal-049.3-python-clean-service-adapter.md`](./goal-049.3-python-clean-service-adapter.md)
  — add the first Python clean-service adapter and product smokes.
- [`goal-049.4-go-clean-service-adapter.md`](./goal-049.4-go-clean-service-adapter.md)
  — add the first Go clean-service adapter and product smokes.
- [`goal-049.5-ping-clean-diagnostic-adapter.md`](./goal-049.5-ping-clean-diagnostic-adapter.md)
  — evaluate and, if safe, graduate a bounded ping/network diagnostic subset
  under the shared contract.

Minimum completion for Goal 49 requires 049.1, 049.2, and at least one of 049.3
or 049.4. 049.5 may complete in the same change only if it meets the same product
bar; otherwise ping remains explicitly refused/proof-only.

## Non-goals

This goal does **not** claim:

- arbitrary CPU/register/stack/process memory portability;
- arbitrary VM memory portability across ISA;
- preserving active TCP/TLS sessions;
- preserving in-flight syscalls, goroutine schedulers, interpreter frames, JIT
  frames, C-extension/cgo/native-addon private state, or kernel object internals;
- preserving arbitrary databases/WAL/stateful services by byte-copy;
- replaying source text as success without provenance and a target verifier;
- success through a sidecar runtime, source-ISA emulator, app hook, proof
  fixture, checked summary, or metadata-only continuation.

## Product workflow requirements

- [ ] The user workflow remains exactly:

  ```sh
  machinen snapshot <name|pid> <bundle-dir>
  machinen restore <bundle-dir>
  ```

- [ ] Do not require `--portable`, `--runtime`, `--language`, `--profile`, or
      any equivalent runtime-specific workflow flag.
- [ ] Do not make `machinen capture` or `machinen support` the product path.
- [ ] `machinen snapshot` must inspect the VM and either write a portable-capable
      normal snapshot bundle or fail closed with a stable refusal code.
- [ ] `machinen restore` must auto-detect the bundle contents, target
      architecture, runtime requirements, and verifier requirements.
- [ ] `machinen restore` must report machine-readable success/refusal output in
      the existing CLI/API style, including `migrationCompleted`, target state,
      refusal code, and verifier result.
- [ ] Same-architecture vmstate/CRIU snapshot/restore behavior must not regress.

## Generic clean-service contract

A service may be accepted only if all required conditions are proven from the
running VM and/or captured bundle:

- [ ] exactly one primary service process or an explicitly modeled process group;
- [ ] argv, env allowlist, cwd, service root, UID/GID where relevant, and runtime
      identity are captured;
- [ ] application/config/package state is contained in captured paths or modeled
      package/provenance descriptors;
- [ ] service exposes a verifier endpoint or verifier command whose output can be
      hashed and checked on the target;
- [ ] listening sockets may be rebound, but no active accepted TCP/TLS session is
      required to survive;
- [ ] no unsupported child process/IPC tree;
- [ ] no unmodeled writable host mount or dirty persistent state;
- [ ] no unmodeled native extension/addon/cgo/JNI/C-extension private state;
- [ ] no unmodeled runtime scheduler/interpreter/JIT continuation state;
- [ ] target runtime can be installed, selected, or verified target-natively;
- [ ] target verifier passes before `migrationCompleted=true`.

## Bundle contract

The normal snapshot bundle must contain a shared clean-service manifest that can
represent multiple detected components:

- [ ] source architecture and target route policy;
- [ ] detected processes, runtimes, service roots, ports, env/cwd/argv, and
      package/build provenance;
- [ ] captured files/artifacts with integrity digests;
- [ ] runtime adapter requirements and target install/selection policy;
- [ ] verifier definition, expected digest/output, and timeout policy;
- [ ] refused components with stable refusal codes and remediation text;
- [ ] explicit security assertions:
      `sourceIsaEmulationUsed=false`, `sourceTextReplayAcceptedAsRestore=false`,
      `sidecarRuntimeUsed=false`, `appHooksRequired=false`, and
      `metadataOnlyContinuation=false` for successful restores.

## Runtime adapter requirements

- [ ] Refactor Goal 47's Node subset to use the shared clean-service manifest.
- [ ] Add either a Python or Go clean-service adapter using the same manifest.
- [ ] Each adapter must add only runtime-specific inspection/refusal logic where
      the generic contract is insufficient.
- [ ] Each adapter must be able to explain, in the manifest and docs, what is
      accepted and what is refused.
- [ ] `machinen support` must report implemented support only for adapters with
      real no-runtime-flag product smokes.

## Required refusals

The generic contract must refuse, with stable codes and
`migrationCompleted=false`:

- [ ] active accepted TCP session;
- [ ] TLS session state that would need to survive;
- [ ] unsupported child process/IPC tree;
- [ ] missing or failing verifier;
- [ ] descriptor/artifact digest tamper;
- [ ] source/target architecture route mismatch;
- [ ] source/target runtime version or ABI mismatch outside accepted policy;
- [ ] dirty or ambiguous writable host-mounted state;
- [ ] unmodeled persistent database or WAL state;
- [ ] unmodeled native addon/C-extension/cgo/JNI state;
- [ ] unmodeled runtime-private scheduler/interpreter/JIT state;
- [ ] package/provenance drift;
- [ ] target runtime unavailable.

Runtime-specific adapters may add stricter refusal codes, but they must map back
to stable product refusal semantics.

## Required smokes

For each implemented adapter, add exact-command product smokes:

- [ ] `arm64 -> amd64` using only `machinen snapshot <vm> <bundle>` and
      `machinen restore <bundle>`;
- [ ] `amd64 -> arm64` using only `machinen snapshot <vm> <bundle>` and
      `machinen restore <bundle>`;
- [ ] unsafe-neighbor snapshot/refusal smoke;
- [ ] descriptor tamper restore refusal;
- [ ] target architecture mismatch restore refusal;
- [ ] verifier mismatch restore refusal;
- [ ] support registry smoke proving the adapter is advertised only after the
      product smokes exist.

## Validation environment

Use this machine as the `arm64` source/target machine. Use the Proxmox machine as
the `amd64` source/target machine. Do **not** use `friend@100.126.46.90` for Goal
49 validation unless a later user instruction explicitly changes this.

Required defaults for cross-architecture validation:

- arm64 side: local/current machine;
- amd64 side: Proxmox host `root@192.168.0.8`;
- do not set `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90`;
- any proof/smoke harness that needs an arm64 source should support a local arm64
  source mode rather than SSHing to `friend`.

## Validation

Run and record timing for:

- [ ] all clean-service adapter product smokes;
- [ ] product support registry matrix;
- [ ] relevant runtime proof matrices for Node and the second adapter;
- [ ] full runtime support matrix;
- [ ] full refusal matrix;
- [ ] full foundation matrix;
- [ ] `pnpm run format:check`;
- [ ] `pnpm run lint`;
- [ ] `pnpm run build:docs`;
- [ ] `pnpm run typecheck`;
- [ ] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [ ] `pnpm exec fallow audit --changed-since origin/main`;
- [ ] `git diff --check`;
- [ ] `pnpm smoke-tests` on this arm64 machine; do not use the `friend` remote
      builder for this goal.

## Completion criteria

Complete when the generic clean-service contract is the product path for Node and
at least one additional runtime family, both pass bidirectional
cross-architecture snapshot/restore with target-native verification, and all
required unsafe states refuse through `machinen snapshot` or `machinen restore`
with stable codes and `migrationCompleted=false`. Any broader runtime/resource
family not implemented must remain proof-only or explicitly refused in product
support surfaces.
