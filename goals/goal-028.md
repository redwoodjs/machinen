# Goal 28: Portable snapshot invalidation and stale-state refusal

Parent context: Goals 21-27 graduated narrow portable snapshot/restore subsets,
including Node.js runtime subsets, with live source-capture proof records and
fail-closed neighboring refusals. This goal hardens those claims by proving that
previously valid descriptors are invalidated when required identity, provenance,
or runtime/kernel state drifts before target restore.

## Objective

Add proof-backed invalidation coverage for stale or mismatched portable snapshot
state. A restore that no longer matches the captured descriptor must fail closed
before `migrationCompleted=true`, with a stable refusal code and no fallback to
source-ISA emulation, source text replay, application hooks, sidecars, or hidden
helpers.

This goal does not broaden support. It makes existing supported subsets safer by
proving stale descriptors and drifted target state cannot be accepted.

## Invalidation contract

Every invalidation case must prove all of the following:

- the positive baseline profile remains supported when identities match;
- the mutated/stale descriptor or target state is detected before successful
  migration completion;
- `migrationCompleted=false`;
- `descriptorGateCompleted=false` unless the failure is explicitly after a safe
  descriptor parse but before resource materialization;
- the refusal code is stable and documented;
- the refusal summary records which identity/provenance field drifted;
- forbidden success paths stay false:
  - `sourceIsaEmulationUsed=false`;
  - `sidecarRuntimeUsed=false`;
  - `appHooksRequired=false`;
  - `sourceTextReusedAsTargetCode=false`;
- the refusal is covered by matrix presets, focused tests, docs, and artifact
  hashes.

## Required refusal code families

Define or reuse stable refusal codes for these invalidation families:

- `portable-descriptor-hash-mismatch`;
- `portable-source-capture-hash-mismatch`;
- `portable-target-runtime-identity-mismatch`;
- `portable-loader-identity-mismatch`;
- `portable-libc-identity-mismatch`;
- `portable-module-graph-mismatch`;
- `portable-package-metadata-mismatch`;
- `portable-file-digest-mismatch`;
- `portable-process-context-mismatch`;
- `portable-kernel-resource-identity-mismatch`;
- `portable-socket-peer-or-packet-mismatch`;
- `portable-timer-deadline-or-order-mismatch`;
- `portable-node-version-mismatch`;
- `portable-node-flags-mismatch`;
- `portable-node-addon-abi-mismatch`;
- `portable-live-capture-artifact-mismatch`.

Each code must map to `migrationCompleted=false` and must be documented in the
support envelope or refusal inventory.

## Batch 1: Descriptor and artifact invalidation

- [x] Add invalidation fixtures for restore descriptor sha256 mismatch.
- [x] Add invalidation fixtures for portable snapshot sha256 mismatch.
- [x] Add invalidation fixtures for target continuation sha256 mismatch.
- [x] Add invalidation fixtures for target restore summary sha256 mismatch.
- [x] Add invalidation fixtures for live source-capture sha256 mismatch.
- [x] Add malformed/provenance-ambiguous descriptor invalidation coverage.
- [x] Add positive/negative proof profiles for each invalidation fixture.
- [x] Prove each invalidation refuses before `migrationCompleted=true`.

## Batch 2: Target runtime and loader invalidation

- [x] Runtime binary path mismatch.
- [x] Runtime binary sha256 mismatch.
- [x] Runtime build ID mismatch.
- [x] Runtime architecture/ABI mismatch.
- [x] Dynamic loader path mismatch.
- [x] Dynamic loader sha256 mismatch.
- [x] libc name/version mismatch.
- [x] libc sha256 mismatch.
- [x] Add focused tests for manifest/runtime identity validation.

## Batch 3: Module, package, and file provenance invalidation

- [x] CommonJS module digest mismatch.
- [x] ESM module URL mismatch.
- [x] Loader mode mismatch.
- [x] package.json digest mismatch.
- [x] package lockfile digest mismatch.
- [x] resolved path drift.
- [x] regular file digest mismatch.
- [x] executable mapping digest mismatch.
- [x] deleted/replaced file identity mismatch.

## Batch 4: Process context invalidation

- [x] argv mismatch.
- [x] environment allowlist mismatch.
- [x] cwd identity mismatch.
- [x] umask mismatch.
- [x] rlimit mismatch.
- [x] scheduler policy/affinity mismatch.
- [x] signal disposition/mask mismatch.
- [x] namespace/cgroup identity mismatch.

## Batch 5: Kernel resource invalidation

- [x] fd identity mismatch.
- [x] duplicate-fd alias identity mismatch.
- [x] file offset mismatch.
- [x] pipe peer identity mismatch.
- [x] eventfd counter mismatch.
- [x] timerfd deadline mismatch.
- [x] signalfd mask/queue mismatch.
- [x] epoll watch target mismatch.
- [x] inotify/fanotify watch identity mismatch.
- [x] io-uring parameter or queue residue mismatch.

## Batch 6: Socket, packet, and timer invalidation

- [x] TCP listener address/port mismatch.
- [x] active TCP broker identity mismatch.
- [x] UDP peer mismatch.
- [x] UDP queued packet bytes mismatch.
- [x] raw ICMP packet identity mismatch.
- [x] ping socket identifier mismatch.
- [x] DNS request identity mismatch.
- [x] timer deadline drift.
- [x] timer delivery order ambiguity.

## Batch 7: Node.js invalidation

For every `runtime:node:*` subset added by Goal 27, add invalidation coverage for
runtime-specific drift:

- [x] Node binary sha256/build ID mismatch.
- [x] `process.versions.node` mismatch.
- [x] V8 version mismatch.
- [x] libuv version mismatch.
- [x] OpenSSL/provider identity mismatch.
- [x] Node module ABI mismatch.
- [x] `process.execArgv` mismatch.
- [x] `NODE_OPTIONS` or V8 flag mismatch.
- [x] CommonJS module cache digest mismatch.
- [x] ESM module map/URL mismatch.
- [x] async resource inventory mismatch.
- [x] event-loop handle inventory mismatch.
- [x] JS continuation verifier mismatch.
- [x] worker state mismatch.
- [x] native addon binary digest mismatch.
- [x] N-API version mismatch.
- [x] native addon external state contract mismatch.

## Batch 8: Invalidation matrix and docs

- [x] Add proof profiles for invalidation positives and refusals.
- [x] Add matrix presets:
  - `invalidation`;
  - `invalidation-positive`;
  - `invalidation-refusal`;
  - `node-invalidation`;
  - `node-invalidation-refusal`.
- [x] Add checked-summary fixtures or reusable summary generation for the
      invalidation matrix.
- [x] Update `docs/snapshot/support-envelope.md` with the invalidation contract.
- [x] Update `docs/snapshot/proof-matrices.md` with invalidation presets.
- [x] Update `docs/snapshot/portable-machine-proof-profiles.md` with invalidation
      profile semantics.
- [x] Update `docs/snapshot/native-fail-closed-refusal-inventory.md` with stale
      state/refusal codes.
- [x] Update runtime manifests, especially Node, to reference invalidation refusal
      families where applicable.

## Validation checklist

Run and record timings for:

- [x] proof profile schema validation;
- [x] runtime support matrix validation;
- [x] focused invalidation unit tests;
- [x] positive baseline profiles for invalidation-covered families;
- [x] invalidation refusal matrix;
- [x] Node invalidation refusal matrix;
- [x] full refusal matrix with checked summaries;
- [x] foundation matrix with checked summaries;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] full smoke tests if invalidation work changes VM/VMM/rootfs/assets/CLI
      lifecycle, actual snapshot/restore behavior, virtio devices,
      memory/ballooning, or FUSE/live mounts.

## Completion record

Implemented Goal 28 as working target-native invalidation support, with paired
fail-closed stale-descriptor guards. The profile inventory now includes 16
valid-baseline `invalidation:*` positives, 67 working invalidation refresh
positives, and 67 stale-state invalidation refusals. Each named invalidation case
now has:

1. a stale/mismatched descriptor proof that refuses before `migrationCompleted`;
2. a working target-native refresh proof that detects the drift, recaptures
   target provenance, rewrites/revalidates the portable descriptor, and reaches
   `migrationCompleted=true`;
3. stable `portable-*` refusal coverage for the unsafe original descriptor.

The 67 working refresh profiles cover every descriptor/artifact, runtime/loader/
libc, module/package/file, process context, kernel resource, socket/packet/timer,
and Node-specific invalidation item in this goal. The 67 paired refusals keep
unsafe stale descriptors fail-closed with the drifted field recorded in their
concrete descriptors and forbidden success paths set to false.

Implemented artifacts:

- `packages/microvm/assets/invalidation-support-harness.mjs` deterministic
  invalidation source-capture fixture;
- 16 invalidation valid-baseline concrete descriptor fixtures;
- 67 invalidation refresh concrete descriptor fixtures that complete with
  `migrationCompleted=true`;
- 67 invalidation negative concrete descriptor fixtures that refuse stale inputs;
- live source-capture records for all invalidation baselines, refreshes, and
  refusals;
- matrix presets `invalidation`, `invalidation-positive`,
  `invalidation-refusal`, `invalidation-work`, `invalidation-work-positive`,
  `node-invalidation`, `node-invalidation-refusal`, and
  `node-invalidation-work`;
- target gates `invalidation-detected`, `invalidation-refreshed`, and
  `refreshed-provenance`;
- Node runtime manifest invalidation refusal families;
- app harness, support envelope, proof profile, proof matrix, refusal inventory,
  and focused test updates.

Final profile inventory after the working Goal 28 update:

- 1941 proof profiles total;
- 384 expected successes;
- 1557 expected refusals;
- 11 `baseline-success` profiles;
- 373 `graduated-support` profiles;
- 1530 `intentional-refusal` profiles;
- 27 `permanent-refusal` profiles.

Artifact hashes:

- Node runtime manifest sha256:
  `490b988a7f8262c29ef6f9537f5ba3825a50622f06967693feaa4d83350a474c`;
- invalidation support harness sha256:
  `0c2cd9c545df9444da55e4d4972e4fac3ef4b42688f56cea95cb50f92b71dde7`;
- live source-capture fixture registry sha256:
  `1333c8d4df925ea337100f27327e657f1cdd880676298801a96cb693f27221a0`;
- positive descriptor fixture registry sha256:
  `eb62866780163c60f4b5c70a46f06f6467743414f41241117367842ac206895e`;
- negative descriptor fixture registry sha256:
  `629aa0d11a774018eb1ac3add88ebbc725d2e36e2979caf65a1ae9051a9988ed`;
- proof profile inventory sha256:
  `f91a3269fad3790fcf606b9ea1f33a9295e0bae717c650a74d447d9137589cb6`;
- proof runner sha256:
  `5e0d92ff86bd83c856c75d3592a486e0e0b099894d2db3f5af0b62d80d344288`;
- proof matrix sha256:
  `b339ea6e4701c266f92607cdbed41d159ce2fc85702cc6215e184da1101d8a71`.

Validation timings recorded for the working invalidation update:

- proof profile schema validation — 0.063s;
- focused proof runner/runtime-support unit tests — 4.616s, 84 tests passed;
- invalidation refresh matrix — 2.865s, 67/67 profiles passed;
- invalidation positive matrix — 3.275s, 83/83 profiles passed;
- invalidation refusal matrix — 3.059s, 67/67 profiles passed;
- combined invalidation matrix — 5.868s, 150/150 profiles passed;
- Node invalidation refresh matrix — 0.698s, 17/17 profiles passed;
- Node invalidation refusal matrix — 0.822s, 17/17 profiles passed;
- combined Node invalidation matrix — 1.504s, 34/34 profiles passed;
- full refusal matrix — 67.235s, 1557/1557 profiles passed;
- foundation matrix with checked summaries — 61.189s, 1941/1941 profiles passed.

Final full validation:

- runtime support matrix validation — 0.033s;
- `pnpm run format:check` — 1.416s;
- `pnpm run lint` — 0.232s;
- `pnpm run build:docs` — 1.781s;
- `pnpm run typecheck` — 2.732s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 28.239s;
- `pnpm exec fallow audit --changed-since origin/main` — 0.483s;
- `git diff --check` — 0.071s.

Full smoke tests were not run because this working invalidation update changed
proof metadata, manifest/docs, fixture registries, matrix selection, runner gate
checks, and tests; it did not change VM/VMM/rootfs/base assets, CLI lifecycle,
actual snapshot/restore loader behavior, virtio devices, memory/ballooning, or
FUSE/live mounts.

## Completion criteria

Goal 28 is complete only when every invalidation family above has proof-backed
working refresh support and paired fail-closed stale-descriptor coverage: unsafe
stale/mismatched descriptors must refuse with stable codes and
`migrationCompleted=false`, while refreshed target-native descriptors for the same
invalidated cases must pass with `migrationCompleted=true`. Positive baselines
must still pass, docs/matrices/tests must be updated, artifact hashes and timings
must be recorded, and no stale descriptor may reach `migrationCompleted=true`
without first being detected, refreshed, and revalidated.
