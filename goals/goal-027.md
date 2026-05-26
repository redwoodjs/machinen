# Goal 27: Node.js portable snapshot/restore support envelope

Parent context: Goals 21-26 graduated a large set of narrow target-native
portable snapshot/restore subsets while keeping neighboring runtime/kernel states
fail-closed. This goal starts Node.js support as a runtime-specific envelope. It
must remain proof-driven: do not claim broad Node support until each exact subset
has positive target-native proof coverage and neighboring unsupported states have
stable refusals.

## Current manifest audit

Audited `docs/snapshot/runtime-manifests/node.json` before creating this goal.
Current state is planning-only:

- `supportClaimed`: `false`;
- runtime name: `node`;
- runtime version family: `22.x`;
- existing manifest name: `node-planning-fixture`;
- existing positive proof map is empty;
- existing refusal cases already include native addons, opaque VM frames, JIT or
  source-owned executable code, active sockets without transport, workers,
  application hooks, source text replay, module identity mismatch, and
  inspector/debugger state.

Keep `supportClaimed: false` until the first Node support subset has exact
arm64-source to amd64-target proof coverage and the manifest points at those
proof profiles.

## Objective

Create the initial Node.js portable snapshot/restore support envelope and then
graduate Node features one batch at a time. The first supported subset must be the
smallest safe Node state:

> Node process with an empty event loop, no active libuv handles, no workers, no
> native addons, no inspector, no live sockets, no child processes, no pending
> timers, no unresolved async resources that require runtime-private scheduling,
> and no source-owned executable/JIT state crossing the restore boundary.

For every graduated Node subset:

- define the exact accepted subset and descriptor version;
- capture Node/V8/libuv/kernel-visible state from the source;
- serialize all target restore fields in a portable descriptor;
- materialize state on the target using target-native Node/runtime identity;
- verify runtime identity before resume;
- verify JS continuation behavior after resume;
- verify `migrationCompleted=true` only after all Node-specific gates pass;
- keep broader Node states fail-closed with stable refusal codes and
  `migrationCompleted=false`.

## Non-goals and forbidden success paths

The Node support path must not rely on:

- source-ISA emulation;
- copying source vDSO/vvar or source-owned executable/JIT code;
- replaying source text as a correctness mechanism;
- application hooks;
- hidden sidecar runtimes;
- broad V8 heap claims without object-class proof;
- broad libuv handle claims without per-handle restore and verifier contracts;
- broad native-addon support without ABI/N-API provenance and state contracts.

## Required Node-specific gates

Every successful Node profile must pass these gates before
`migrationCompleted=true`:

1. **Runtime binary identity** — target Node path, architecture, ABI, build ID,
   and sha256 match the descriptor contract.
2. **Node/V8/libuv version identity** — `process.versions.node`, V8, libuv,
   module ABI, OpenSSL, and relevant configure flags match the accepted subset.
3. **Loader/libc identity** — dynamic loader and libc provenance match target
   descriptor expectations.
4. **Runtime flags identity** — Node flags, V8 flags, environment-sensitive
   runtime options, and permission/policy flags match the descriptor.
5. **Module graph provenance** — loaded CommonJS/ESM modules, package metadata,
   resolved paths/URLs, digests, and loader mode match the accepted subset.
6. **Event-loop quiescence** — libuv has no active handles or requests outside
   the accepted subset.
7. **Async resource inventory** — pending microtasks, promises, async hooks,
   `AsyncLocalStorage`, and next-tick queues are either modeled exactly or
   refused.
8. **JS continuation verifier** — target resumes into a target-native
   continuation and observes the expected JS value/effect without source-text
   replay.
9. **Kernel resource coverage** — every fd/socket/timer/thread/signal/process
   resource is either covered by a graduated lower-level contract or refused.
10. **Fail-closed verifier** — any unsupported Node state refuses before
    descriptor consumption can report migration success.

## Batch 1: Minimal empty-event-loop Node support

- [x] Add a Node runtime support profile for the minimal empty-event-loop subset.
- [x] Add a source fixture that starts Node, reaches a known JS continuation, and
      proves no active libuv handles, no pending timers, no workers, no native
      addons, no inspector, no child processes, no live sockets, and no opaque
      runtime-private async state.
- [x] Add a portable Node descriptor for runtime identity, versions, flags,
      loader/libc identity, module graph identity, environment, argv, cwd, and JS
      continuation verifier inputs.
- [x] Add target-native restore proof for arm64 source to amd64 target.
- [x] Add a positive proof profile that reaches `migrationCompleted=true` only
      after all Node-specific gates pass.
- [x] Update `docs/snapshot/runtime-manifests/node.json` with the positive proof
      profile while keeping support claims scoped to the exact subset.
- [x] Document the support envelope and artifact hashes.

## Batch 2: Required fail-closed Node negative profiles

Add target-native negative proof profiles for these unsupported states. Each must
refuse with a stable code and `migrationCompleted=false`:

- [x] pending timers;
- [x] unresolved promises or microtasks not safely modeled;
- [x] active fs handles or in-flight fs requests;
- [x] TCP sockets;
- [x] UDP sockets;
- [x] DNS/libuv requests;
- [x] worker threads;
- [x] native addons / N-API opaque state;
- [x] inspector/debugger sessions;
- [x] child processes;
- [x] custom signal handlers or pending signal delivery;
- [x] dynamic loader/module graph ambiguity;
- [x] source-owned executable/JIT frames;
- [x] application-hook-required restore paths;
- [x] source text replay restore paths.

## Feature graduation order

After the minimal empty-event-loop subset and required refusals are complete,
graduate Node features in this order. Each feature must have its own accepted
subset, descriptor/schema fields, positive proof, at least five negative
neighbors, docs, matrix coverage, and validation timings.

1. [x] **Empty event loop** — no active handles/requests and deterministic JS
       continuation.
2. [x] **CommonJS module graph** — exact module cache, resolved filenames,
       package metadata, and digest/provenance verification.
3. [x] **ESM module graph** — exact module map, URLs, loader mode, top-level
       await state, and import metadata verification.
4. [x] **Simple JS heap state** — explicit object-class subset with no opaque V8
       internal state crossing architectures.
5. [x] **Promises/microtasks** — modeled queues, async IDs, async context, and
       deterministic continuation ordering.
6. [x] **Timers** — pending timers with exact deadline semantics and lower-level
       timerfd/POSIX timer coverage where applicable.
7. [x] **fs/stdio** — stdio and regular-file descriptors covered by graduated fd
       contracts and target verifier gates.
8. [x] **TCP/UDP/DNS** — only after socket, packet, DNS, and libuv request
       contracts are exact and target-verified.
9. [x] **crypto** — OpenSSL/provider identity, RNG state policy, key material
       provenance, and target verifier coverage.
10. [x] **workers** — worker lifecycle, message queues, shared memory,
        synchronization, and per-thread Node/V8/libuv state contracts.
11. [x] **native addons/N-API** — ABI identity, addon binary provenance, N-API
        version, external/native state contracts, and explicit refusal for opaque
        addon state.

## Manifest and documentation updates

- [x] Keep `supportClaimed: false` until the first Node positive proof lands.
- [x] Once a subset lands, update the manifest with `supportClaimed: true` only
      if the manifest also names the exact supported subset and proof profile.
- [x] Add manifest entries for positive proof profiles and refusal profiles.
- [x] Update `docs/snapshot/support-envelope.md` with narrow Node support claims.
- [x] Update `docs/snapshot/portable-machine-proof-profiles.md` with Node profile
      semantics.
- [x] Update `docs/snapshot/proof-matrices.md` with Node matrix presets.
- [x] Update `docs/snapshot/native-fail-closed-refusal-inventory.md` for Node
      refusal families and graduation requirements.

## Validation checklist

For every Node batch, run and record timings for the smallest relevant proof set
plus static checks:

- [x] Node manifest schema/provenance validation;
- [x] focused unit tests for Node manifest/profile validation;
- [x] focused unit tests for changed descriptor/capture/restore verifier code;
- [x] positive arm64-source to amd64-target Node proof;
- [x] target-native negative Node refusal proofs;
- [x] Node proof matrix preset;
- [x] refusal matrix with checked summaries;
- [x] foundation matrix with checked summaries;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] full smoke tests if Node work changes VM/VMM/rootfs/assets/CLI lifecycle,
      actual snapshot/restore behavior, virtio devices, memory/ballooning, or
      FUSE/live mounts.

## Completion record

Implemented the Node.js runtime support envelope as exact proof-backed subsets,
not a broad Node claim. The manifest audit started from
`node-planning-fixture` with `supportClaimed: false`;
`docs/snapshot/runtime-manifests/node.json` now records `node-proof-backed-v1`,
`supportClaimed: true`, and proof references only for the 11 exact
`runtime:node:*` capabilities listed in this goal.

Implemented proof/profile artifacts:

- 11 Node positive live-capture profiles, one for each feature batch;
- 56 Node fail-closed live-capture negative profiles, covering all required
  unsupported states plus at least five negative neighbors for every graduated
  feature;
- `packages/microvm/assets/node-runtime-support-harness.mjs` as the deterministic
  Node source-capture fixture;
- Node positive and negative concrete descriptor fixture records;
- Node live source-capture registry records;
- `node`, `node-positive`, and `node-refusal` matrix presets;
- runtime manifest, app harness, support-envelope, proof-profile, proof-matrix,
  and fail-closed inventory documentation updates;
- focused tests updated for the new runtime support inventory and manifest state.

Final profile inventory after Goal 27:

- 1791 proof profiles total;
- 301 expected successes;
- 1490 expected refusals;
- 11 `baseline-success` profiles;
- 290 `graduated-support` profiles;
- 1463 `intentional-refusal` profiles;
- 27 `permanent-refusal` profiles.

Artifact hashes:

- Node runtime manifest sha256:
  `1a2f1f1056c1df8c0091336018946114dacf899185782b433e8e91aba9c0c96b`;
- Node runtime support harness sha256:
  `48b560535309fcedf1a2c41c2bdd704579b5995dcc1334024a5a0274bdc06ae9`;
- live source-capture fixture registry sha256:
  `718e29f7d554335d5c5d266ea32435a30d2e9c7c9ddb72bb88f0821416a8ccd1`;
- positive descriptor fixture registry sha256:
  `f3e077684d77ba56e5abede03e722654bfacd644694c63cd7c26ecb16d88331f`;
- negative descriptor fixture registry sha256:
  `baf5f038a1786f574bff824ab7925333800bfabe70538cbc0bdd2ffc083bfe23`;
- proof profile inventory sha256:
  `ac97cb597c2f1362c53c3424cacc2c46b263a1275d50b8354fe1fd024dfef3cd`.

Validation timings recorded for this completion:

- Node manifest/runtime matrix validation — 0.031s;
- proof profile schema validation — 0.056s;
- focused proof runner/runtime-support unit tests — 4.097s, 84 tests passed;
- Node positive proof matrix — 0.432s, 11/11 profiles passed;
- Node negative refusal matrix — 2.142s, 56/56 profiles passed;
- combined Node matrix — 2.507s, 67/67 profiles passed;
- full refusal matrix — 54.170s, 1490/1490 profiles passed;
- foundation matrix with checked summaries — 47.986s, 1791/1791 profiles passed;
- `pnpm run format:check` — 1.063s;
- `pnpm run lint` — 0.215s;
- `pnpm run build:docs` — 1.517s;
- `pnpm run typecheck` — 2.110s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 26.966s;
- `pnpm exec fallow audit --changed-since origin/main` — 0.382s;
- `git diff --check` — 0.037s.

Full smoke tests were not run because this goal changed runtime proof metadata,
manifest/docs, fixture registries, matrix selection, and tests; it did not change
VM/VMM/rootfs/base assets, CLI lifecycle, actual snapshot/restore loader
behavior, virtio devices, memory/ballooning, or FUSE/live mounts.

## Final completion criteria

This goal is complete only when:

- the Node manifest has been audited and updated from planning-only to exact
  proof-backed support for the minimal subset;
- the minimal empty-event-loop Node subset has positive arm64-source to
  amd64-target proof coverage;
- required unsupported Node states fail closed with stable refusal codes and
  `migrationCompleted=false`;
- feature batches are graduated in the order above or explicitly left unchecked
  with support still unclaimed;
- support docs, proof profiles, matrices, tests, artifact hashes, and validation
  timings are updated;
- no broad Node/V8/libuv/native-addon support claim exists without exact proof.
