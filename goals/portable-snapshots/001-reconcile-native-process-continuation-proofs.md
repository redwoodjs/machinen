# Goal 001: Reconcile native process-continuation proofs

Audit doc: `docs/snapshot/native-process-continuation-audit.md`

Machine-readable inventory:
`docs/snapshot/checked-summaries/portable-snapshots/native-process-continuation-audit.json`

## Objective

Audit and reconcile existing native/process-continuation proofs into the
portable snapshots roadmap, then identify the actual remaining gaps
to productize them.

## Motivation

The repo already contains substantial process-continuation work under the older
`portable-snapshot-format` roadmap. The controlled-counter path was misleading as
a roadmap milestone and has been removed; the roadmap should build on existing
native, Node, runtime, and stateful-service evidence instead.

This goal aligns the portable snapshots roadmap with the existing
native, Node, runtime, stateful-service, and product-claim evidence.

## Required audit

- [x] Inventory native/process modules and scripts:
      registers, stack, return chain, memory, executable materialization, process
      context, signal, active syscall, TLS, SIMD/FPU, threads, and target loaders.
- [x] Inventory completed Node live restore/process evidence from Goals 33-37.
- [x] Inventory non-Node runtime evidence for Go, Python, Ruby/JVM status, and
      runtime refusals.
- [x] Inventory ping semantic continuation and raw socket/process-state refusals.
- [x] Inventory database/stateful-service logical restore and process-state
      refusals.
- [x] Inventory product-supported clean-service subsets from the product claim
      registry.

## Required reconciliation

- [x] Classify each evidence family as one of:
      product-supported, proof-only live target proof, proof-only fixture,
      semantic continuation, semantic restart, runtime-aware continuation,
      native/process continuation proof, stable refusal, or obsolete/invalid.
- [x] Identify which `migrationCompleted=true` claims are live target-native
      proofs and which are descriptor/semantic/product restart claims.
- [x] Identify which proofs use public `machinen snapshot` / `machinen restore`
      and which depend on side proof scripts or checked summaries.
- [x] Identify which existing proofs are meaningful process-continuation evidence
      versus workload-level semantic restore.
- [x] Remove the controlled C counter from the active roadmap/runtime surface and
      update docs so it is not treated as a meaningful continuation milestone.

## Product gap analysis

For each workload family, document what remains before product support:

- [x] Node.js.
- [x] Ping/network diagnostics.
- [x] PostgreSQL and databases.
- [x] Go/Python/Ruby/JVM runtimes.
- [x] Native/process continuation foundations.
- [x] Kernel/resource reconstruction.

Each gap must say whether the missing work is:

- [x] product API/CLI wiring;
- [x] target-native restore implementation;
- [x] target verifier coverage;
- [x] bundle/descriptor/integrity work;
- [x] unsupported-state detection/refusal;
- [x] docs/support discovery;
- [x] live opposite-ISA validation;
- [x] genuinely missing process-state translation.

## Deliverables

- [x] A reconciliation audit doc under `docs/snapshot/`.
- [x] Updated portable snapshots goal index pointing to this reconciliation path.
- [x] Removal of newly-created roadmap goals that incorrectly imply we are
      starting from scratch.
- [x] Existing proof/product/refusal families referenced with exact file paths.
- [x] Clear next-step recommendations that build on prior work.

## Validation

Run and record timings for:

- [x] `pnpm run format:check`
- [x] `pnpm run lint` if TypeScript/scripts change
- [x] `pnpm run build:docs` if public docs/API generation is affected
- [x] `pnpm exec fallow audit --changed-since origin/main` if code changes

For docs-only reconciliation, explain why runtime/unit/full smoke tests are not
needed.

## Completion record

Completed by adding:

- `docs/snapshot/native-process-continuation-audit.md`
- `docs/snapshot/checked-summaries/portable-snapshots/native-process-continuation-audit.json`
- `goals/portable-snapshots/INDEX.md`

Validation run:

- `pnpm run format:check` — passed in 1.29s
- `pnpm run lint` — passed in 0.20s
- `pnpm run build:docs` — passed in 1.72s
- `pnpm exec fallow audit --changed-since origin/main` — passed in 0.37s

Runtime/unit/full smoke tests were not run because this is a docs and roadmap
reconciliation change only. It does not change TypeScript runtime behavior, VM
lifecycle, VMM code, rootfs/base assets, CLI boot/exec/mount, snapshot/restore
machinery, virtio devices, memory/ballooning, or FUSE/live mounts.
