# Goal 47: Actual cross-architecture `machinen snapshot` / `machinen restore`

Parent context: Goals 45-46 added useful descriptor, refusal, and claim-registry
machinery, but they did not deliver the user-facing workflow we actually need.
The real product requirement is not a side-channel `capture` command, not a
support-status registry, and not extra runtime-specific flags. Users must be able
to use the existing Machinen product verbs:

```sh
machinen snapshot <name|pid> <bundle-dir>
machinen restore <bundle-dir>
```

across `arm64 <-> amd64` for explicitly supported portable subsets. Machinen
should do the discovery, partitioning, capture, restore planning, and refusal
work itself.

## Problem statement

Today, cross-architecture feasibility exists in proof fixtures and checked
summaries, and Goal 45 productized PostgreSQL logical state through a separate
capture-style workflow. That is not enough. A user running a VM with a supported
workload, such as a clean/quiesced Node.js service, should be able to snapshot it
with `machinen snapshot`, move the bundle to the opposite architecture, and run
`machinen restore` there. Unsupported states must fail closed through the same
commands.

## Objective

Implement real product support for cross-architecture portable snapshot/restore
through the existing `machinen snapshot` and `machinen restore` commands, with no
runtime-specific user flags required.

The goal is complete only when Machinen can inspect a real VM, capture every
known-safe portable component it can model, refuse every required unsupported or
ambiguous component, restore the resulting bundle on the opposite architecture
via `machinen restore`, and verify target-natively before
`migrationCompleted=true`. Nearby unsupported states must refuse through
`machinen snapshot` or `machinen restore` with stable codes and
`migrationCompleted=false`.

## First target

Start with Node.js because it is the user-visible workload that exposed the gap:

- source VM is running a real Node.js service started through Machinen;
- source workload is inside an explicitly supported subset, initially clean and
  quiesced with no active TCP/TLS session that must survive, no inspector
  session, no child-process/IPC tree, no dirty host-mounted state, no opaque
  native addon state, and no unsupported V8/libuv/OpenSSL private continuation;
- `machinen snapshot <node-vm> <bundle-dir>` writes a portable bundle;
- `machinen restore <bundle-dir>` on the opposite architecture reconstructs the
  service with target-native Node and verifies behavior before success;
- both `arm64 -> amd64` and `amd64 -> arm64` routes pass.

PostgreSQL logical state from Goal 45 may be used as a second supported subset,
but it cannot be the only result of this goal unless Node.js is explicitly and
stably refused through `machinen snapshot` / `machinen restore` with actionable
next steps.

## Product-surface requirements

- [ ] Do not add another top-level command for the core workflow. The supported
      path must be `machinen snapshot` and `machinen restore`.
- [ ] Do not add runtime-specific workflow flags such as `--runtime node`, and do
      not require a `--portable` flag for the normal product path. Machinen must
      inspect the VM, decide what is portable, and either write a portable-capable
      bundle or refuse.
- [ ] `machinen snapshot` must produce a bundle whose `meta.json` / descriptor
      clearly records: snapshot engine, source architecture, cross-architecture
      route policy, all detected runtime/resource/service components, which
      components were captured, which components were refused, provenance,
      integrity digests, verifier requirements, and refusal semantics.
- [ ] `machinen restore` must auto-detect the bundle contents and target
      architecture, restore every required supported component target-natively,
      and refuse with stable product codes if any required component cannot be
      safely restored. It must not require users to call `capture`, pass a
      runtime flag, or parse a proof summary.
- [ ] `machinen restore` must report machine-readable success/refusal output in
      the existing CLI/API style, including `migrationCompleted`, target state,
      refusal code, and verifier result.
- [ ] Existing same-architecture vmstate/CRIU snapshot/restore behavior must not
      regress.

## Implementation requirements

- [ ] Define the portable bundle contract used by product `machinen snapshot` and
      `machinen restore`, including a component manifest that can represent
      multiple captured/refused VM workload components in one bundle. Reuse Goal
      45/46 descriptor pieces only where they fit the product workflow.
- [ ] Implement source VM inspection for the first Node.js subset. The snapshot
      command must derive state from the running Machinen VM/workload, discover
      Node and neighboring resources automatically, and not rely on a pre-written
      proof fixture, checked summary, `--runtime node`, or app hook.
- [ ] Implement target restore/reconstruction for the first Node.js subset using
      target-native Node on the destination architecture.
- [ ] Implement target-native verification before reporting
      `migrationCompleted=true`.
- [ ] Implement fail-closed snapshot/restore refusals for nearby Node states:
      active TCP/TLS session, inspector/debug session, child process or IPC tree,
      unsupported native addon/ABI state, dirty persistent state, host-mounted
      ambiguity, source/target Node version mismatch, descriptor tamper, target
      architecture mismatch, and missing target verifier.
- [ ] If PostgreSQL logical state remains supported, auto-detect and route it
      through `machinen snapshot` / `machinen restore` too, not only through
      `machinen capture postgres`.
- [ ] Add tests that fail if `machinen capture`, `machinen support`,
      `--portable`, `--runtime`, proof fixtures, or checked summaries are the
      only way to exercise a claimed product restore.
- [ ] Update `machinen support` so it reflects actual snapshot/restore product
      support, not just proof/claim status.
- [ ] Document the exact zero-extra-runtime-flag user workflow, supported
      subset, captured/refused component report, refusal codes, and
      troubleshooting/remediation path.

## Required validation

Run and record timing for:

- [ ] `arm64 -> amd64` Node product snapshot/restore smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] `amd64 -> arm64` Node product snapshot/restore smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] Node nearby-unsafe-state refusal smoke through `machinen snapshot` or
      `machinen restore`;
- [ ] descriptor tamper / target-architecture mismatch / verifier mismatch
      refusals through `machinen restore`;
- [ ] PostgreSQL product snapshot/restore smoke through `machinen snapshot` and
      `machinen restore` if PostgreSQL remains claimed as implemented support;
- [ ] product support registry matrix proving every implemented support entry has
      a no-runtime-flag `machinen snapshot` / `machinen restore` smoke;
- [ ] relevant Node proof matrices and checked-summary comparison;
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
- [ ] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`.

## Completion criteria

Complete when a user can run `machinen snapshot` on a VM containing a supported
Node.js workload, move the resulting bundle across `arm64 <-> amd64`, run
`machinen restore`, and get target-native verified continuation or a stable,
actionable refusal through those same commands. Machinen must automatically
inspect and capture every known-safe portable component and refuse every required
unknown/unsafe component. The result must not depend on a separate capture
command, `--portable`, `--runtime`, proof-only fixture, checked summary,
source-ISA emulation, source text replay, app hooks, sidecar runtime success, or
metadata-only continuation.
