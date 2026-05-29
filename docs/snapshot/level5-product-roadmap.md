# Level 5 product roadmap

Level 5 is the target: a live workload continues across CPU architectures through
target-native process reconstruction. The project has useful proof work, but no
runtime-profile or app-specific shortcut should be treated as product Level 5.

## Product rule

A Level 5 product claim must be based on captured source machine/process state and
target-native reconstruction or translation of that state.

A product claim must not be based on:

- runtime-profile routes as the product mechanism;
- app-exported state or selected-state descriptors;
- checkpoint hooks inside the app/runtime;
- sidecar replay or helper output standing in for the workload;
- source-ISA emulation;
- source text replay as target code;
- metadata-only success.

Those approaches can remain proof fixtures or refusal tests, but they must be
labeled as such and keep product support separate.

## Minimum evidence for a Level 5 candidate

A candidate should show, in a checked summary:

- source architecture and target architecture;
- source process identity and captured state provenance;
- target-native executable/module provenance;
- translated or reconstructed registers, stack frames, private memory, code
  mappings, TLS, signal state, active syscall policy, and thread policy for the
  accepted subset;
- Level 4 descriptors or stable refusals for kernel resources such as sockets,
  pipes, eventfd, timerfd, epoll, files, and readiness;
- target verifier output from the actual target workload;
- `sourceIsaEmulationUsed=false`, `sidecarRuntimeUsed=false`,
  `sourceTextReusedAsTargetCode=false`, and `metadataOnlySuccess=false` or an
  equivalent explicit gate;
- stable refusal codes with `migrationCompleted=false` for every unsafe neighbor.

## Current useful building blocks

The relevant work is mostly app-neutral native/process and Level 4 resource work:

- native process image and descriptor capture;
- register/stack/return-chain translation;
- memory and executable mapping materialization;
- target restore loader and target VM restore proofs;
- active syscall, signal, TLS, SIMD/FPU, and thread refusal policies;
- Level 4 ping, eventfd, pipe, timerfd, and TCP listener descriptors;
- whole-VM vmstate for same-ISA machine restore.

Runtime-specific docs can inform refusal policy and fixtures, but should not be
the product path.

## What to do with older Node/runtime work

Older Node live, production, expanded, complex, ecosystem, non-Node, and Go
quiescent restore suites are archived from the smoke surface. They may contain
useful fixture ideas, but their success language should not be copied into new
product docs unless it is reworked around actual source process state capture and
target-native reconstruction.

For Node, the next useful Level 5 work is not another runtime profile. It is a
narrow captured-process subset that proves actual source Node process state is
translated/reconstructed on the target, while unsupported V8/libuv/native-addon,
worker, inspector, active-request, active-TCP, active-syscall, and arbitrary heap
neighbors refuse.

## Relationship to goals

- Goal 020 and Goal 021 are historical/proof-only runtime-profile work.
- Goal 022 is the desired quickstart shape, but it must graduate only through
  actual captured workload state, not selected-state or runtime-profile success.
- Goal 023 defines the proper Level 5 continuation track without runtime-profile
  product shortcuts.
