# Native/process-continuation audit

This audit reconciles the older native/process-continuation work with the newer
portable snapshots roadmap. It corrects the impression that the
controlled C counter proof is the beginning of process continuation work. It is
not. It is a contract/gauntlet check layered on top of a much larger existing
body of proof and product work.

## Bottom line

Machinen already has substantial architecture-portable continuation work in the
`portable-snapshot-format` roadmap and native runtime modules.

The remaining gap is not "start with a counter." The remaining gap is to separate
three categories and productize only the honest supported ones:

1. **Implemented product support** through `machinen snapshot <vm> <bundle>` and
   `machinen restore <bundle>`.
2. **Proof-only process/native continuation evidence** with live or fixture
   target-native proofs.
3. **Stable refusals** for process/kernel/runtime state that is not modeled.

## Machine-readable inventory

A checked, machine-readable version of this audit is stored at:

```txt
docs/snapshot/checked-summaries/portable-snapshots/native-process-continuation-audit.json
```

It records evidence families, product status, process-continuation status,
`migrationCompleted` semantics, public product surface status, exact evidence
paths, and remaining gaps.

## Current product-supported subsets

These are advertised in `docs/snapshot/product-claim-registry.md` and
`docs/snapshot/product-cross-arch-claim-inventory.json` as implemented product
support:

| Subset                                           | Level                         | Notes                                                                                  |
| ------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------- |
| `node-http-clean-root-v1`                        | Level 1 semantic restart      | Clean Node HTTP service through `machinen snapshot` / `machinen restore`.              |
| `python-http-clean-root-v1`                      | Level 1 semantic restart      | Clean Python HTTP service through the clean-service contract.                          |
| `go-http-clean-root-v1`                          | Level 1 semantic restart      | Clean static Go HTTP service with cgo/dynamic linkage refused.                         |
| `ping-sequence-counter-semantic-continuation-v1` | Level 2 semantic continuation | Descriptor-based ping sequence/counter continuation; raw socket state remains refused. |

These are product-supported workload continuation paths, not arbitrary Linux
process-image continuation.

## Existing proof-only process/native work

The repo already contains native process-continuation machinery and proof
fixtures. Important files include:

| Area                                 | Evidence                                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native process image and descriptors | `packages/runtime/src/native-process-image.ts`, `native-machine-restore-descriptor.ts`, `native-machine-restore-plan.ts`                                                                                                                |
| Register/state translation           | `native-register-translation.ts`, `native-target-frame-state.ts`, `native-target-caller-frame.ts`                                                                                                                                       |
| Stack/return-chain translation       | `native-stack-translation.ts`, `native-stack-window-materializer.ts`, `native-return-chain.ts`, `native-return-chain-materializer.ts`                                                                                                   |
| Memory/executable materialization    | `native-memory-translation.ts`, `native-mapping-materialization.ts`, `native-target-module-bytes.ts`, `native-target-landing-provenance.ts`                                                                                             |
| Runtime/resource boundaries          | `native-resource-translation.ts`, `native-resource-recipe.ts`, `native-active-syscall-policy.ts`, `native-signal-policy.ts`, `native-thread-restore-policy.ts`, `native-tls-segment-policy.ts`, `native-simd-fpu-policy.ts`             |
| Target restore planning              | `target-guest-restore-loader.ts`, `target-guest-memory-materialization.ts`, `target-guest-process-context-restore.ts`, `target-guest-active-syscall-restore.ts`, `target-guest-signal-restore.ts`, `target-guest-two-thread-restore.ts` |
| Native proof scripts                 | `scripts/native-actual-real-utility-continuation.ts`, `native-dwarf-unwind-frames.ts`, `native-real-utility.ts`, `native-stack-translate.ts`, `native-register-translate.ts`, `native-target-vm-synthetic-continuation.ts`              |

The product claim registry classifies many of these under:

- `family=foundation-native`
- `family=native-linux-resource`

Most positive native proofs remain `proof-only-fixture` with
`product-surface-not-implemented`. Many unsafe neighbors are already stable
product refusals with `migrationCompleted=false`.

## Existing Node/process restore evidence

The older portable snapshot goals are much further along than the controlled C
counter proof.

### Goal 33.3: minimal live Node VM restore

`goals/portable-snapshot-format/goal-033.3-minimal-live-node-vm-restore.md`
records a completed live Node path:

- real long-running Node process;
- live arm64 capture;
- portable bundle generation;
- Proxmox amd64 target VM restore;
- target-native Node/process materialization;
- post-restore verifier output;
- `migrationCompleted=true`;
- `descriptorGateCompleted=true`;
- gates for resources, verifier, state consumption, return chain, frame,
  registers, TLS, stack window, private memory, executable, process context,
  signal, active syscall, controlled thread, resume path, and Node app output;
- forbidden paths false: source-ISA emulation, source text reuse, sidecar runtime,
  app hooks.

This is meaningful process-continuation evidence. It is still not arbitrary Linux
process continuation, but it is not "just a counter."

### Goal 35.1: arbitrary existing Node process capture

`goals/portable-snapshot-format/goal-035.1-arbitrary-existing-node-processes.md`
records completed discovery/capture/restore proof for already-running Node
processes in a claimed subset, with unsupported neighboring states refused.

Checked summary example:

- `docs/snapshot/checked-summaries/node-expanded/node-expanded-arbitrary-existing-processes.json`
- `migrationCompleted=true`
- `descriptorGateCompleted=true`
- target-native execution;
- source-ISA emulation false;
- sidecar runtime false;
- app hooks false;
- refusal count recorded for unsafe neighbors.

## Existing non-Node and stateful-service evidence

The repo also has checked summaries for:

- Go/Python cross-architecture runtime policies under
  `docs/snapshot/checked-summaries/non-node-cross-arch/`;
- Go quiescent runtime proofs under
  `docs/snapshot/checked-summaries/go-quiescent-runtime/`;
- stateful service restore/refusal matrices under
  `docs/snapshot/checked-summaries/stateful-services/`;
- PostgreSQL logical restore/refusal work, with product caveat that it is not yet
  advertised through the no-runtime-flag `machinen snapshot` / `machinen restore`
  path.

These are workload/runtime/state continuations or semantic restores. They should
not be collapsed into arbitrary process continuation.

## Why the controlled C counter felt worthless

The controlled C counter proof is useful only as a strict contract check:

- source and target ISA differ;
- target execution is native;
- bundle/provenance/digests exist;
- target verifier output is required;
- source emulation, raw replay, sidecar, and metadata-only shortcuts are refused;
- `migrationCompleted=true` is gated on a live target-native opposite-ISA run.

It does not translate a real process image. It should be treated as a guardrail,
not a product milestone.

## Actual remaining gaps

These are future productization gaps, not missing work for this audit.

### 1. Reconcile taxonomy

- Add portable snapshot rows for the existing native/process proof families
  instead of treating the counter as the only continuation row.
- Distinguish semantic restart, semantic continuation, runtime-aware
  continuation, native/process proof fixture, stable refusal, and product support
  in one registry view.
- Ensure `migrationCompleted=true` means the same thing across old and new
  summaries.

### 2. Productize existing live proofs where appropriate

- Decide whether Goal 33.3 / Goal 35 Node process proofs should remain
  proof-only or feed a product-supported subset.
- If productizing, route them through the public no-runtime-flag
  `machinen snapshot <vm> <bundle>` / `machinen restore <bundle>` flow.
- Keep unsupported Node/V8/libuv/native-addon/socket states refused with stable
  codes.

### 3. Promote native process proof evidence into the gauntlet

- Add checked gauntlet rows for native register/stack/memory/return-chain, target
  loader, active syscall, signal, TLS, SIMD/FPU, and thread policy evidence.
- Keep proof-only native fixtures out of product support until product
  descriptors, CLI/API, docs, and end-to-end validation exist.

### 4. Clarify workload-specific expectations

- Ping: product-supported semantic continuation exists for sequence/counter; raw
  socket/process state remains refused.
- Node: clean service restart is product-supported; deeper process continuation
  proofs exist but need taxonomy/product-surface reconciliation.
- Database: logical/stateful service restore proofs exist; live database process
  continuation is not supported.

### 5. Keep active goals aligned with prior work

- Do not add goals that imply we are starting from scratch.
- Future goals should point at existing native and `portable-snapshot-format`
  evidence.

## Recommended next goal

Create a goal named:

```txt
Reconcile native process-continuation proofs into the portable snapshots roadmap
```

It should produce:

- a machine-readable inventory of existing proof/product/refusal summaries;
- an architecture-portable snapshot gauntlet section for native/process evidence;
- updated product claim registry mapping for native/process proof families;
- explicit productization gaps for Node, ping, database, and native process
  continuation;
- no new counter-style proof unless it exercises a genuinely missing process
  dimension.
