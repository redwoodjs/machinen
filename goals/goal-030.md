# Goal 30: Real Node.js end-to-end app smoke suite

Parent context: Goals 27-29 made all tracked `runtime:node:*` profiles supported
in the proof/profile inventory, added representative Node app proof profiles, and
reduced Node refusals to zero. This goal turns that proof envelope into practical
end-to-end confidence by running real Node.js applications through the actual
capture → portable descriptor → target restore path.

## Objective

Add a real end-to-end Node.js smoke suite. Each app must be a real Node workload,
not only a manifest/profile fixture. The suite must prove that supported Node app
states can be captured on the source, restored on the target, and verified by
observable app behavior without source-ISA emulation, source-text replay,
application hooks, sidecar runtimes, or hidden helpers.

## Required real app workloads

Implement real workloads for all representative Node app classes:

1. [x] **CLI script** — deterministic stdout/stderr, argv/env/cwd verification.
2. [x] **CommonJS package app** — `require()` graph, package metadata, module
       cache identity, deterministic output.
3. [x] **ESM package app** — ESM import graph, URL/module metadata, deterministic
       output.
4. [x] **Timers/async app** — timers, promises, microtasks, `nextTick`, and
       `setImmediate` ordering for the accepted subset.
5. [x] **fs/stdio app** — file read/write/append/stat plus stdio behavior under
       graduated fd contracts.
6. [x] **HTTP/TCP server app** — listener restore, request/response verification,
       readiness, and target-side client probe.
7. [x] **UDP/DNS app** — UDP packet verification plus DNS/libuv request behavior
       for the accepted subset.
8. [x] **Worker thread app** — worker lifecycle, bounded message queue,
       deterministic result, and shutdown behavior.
9. [x] **Native addon / N-API app** — real addon binary/provenance, bounded
       external state, N-API version verifier, deterministic result.
10. [x] **Crypto/TLS app** — crypto provider identity, key material policy,
        bounded TLS/session behavior, deterministic verifier.

## End-to-end requirements for each workload

Each workload must have:

- real source files under a tracked fixture directory;
- a source capture command that runs on the source architecture;
- portable descriptor output with Node runtime/app fields;
- target restore invocation through the normal restore path;
- target-side verifier that observes app behavior, not just descriptor metadata;
- positive proof profile with `expectedResult: "success"`;
- `migrationCompleted=true` only after the app verifier passes;
- app harness JSON under `docs/snapshot/app-harnesses/`;
- matrix coverage;
- artifact hashes recorded in this goal;
- no forbidden success paths:
  - `sourceIsaEmulationUsed=false`;
  - `sidecarRuntimeUsed=false`;
  - `appHooksRequired=false`;
  - `sourceTextReusedAsTargetCode=false`.

## Negative and regression coverage

For each workload, add or reuse fail-closed regression coverage for:

- wrong Node binary/build ID;
- stale module/package graph;
- missing target runtime;
- loader/libc mismatch;
- source text replay attempt;
- app hook requirement;
- sidecar runtime success path;
- unsupported runtime state outside the accepted subset.

These regressions must fail before `migrationCompleted=true`.

## Smoke runner and matrix requirements

- [x] Add a real Node smoke runner or extend the existing portable machine smoke
      runner to select Node app workloads.
- [x] Add matrix presets:
  - `node-real-apps`;
  - `node-real-apps-positive`;
  - `node-real-cli`;
  - `node-real-cjs`;
  - `node-real-esm`;
  - `node-real-timers-async`;
  - `node-real-fs-stdio`;
  - `node-real-http-tcp`;
  - `node-real-udp-dns`;
  - `node-real-worker`;
  - `node-real-native-addon`;
  - `node-real-crypto-tls`.
- [x] Add artifact inventory output for real Node app capture/restore artifacts.
- [x] Add checked-summary support so CI can validate saved real Node summaries.
- [x] Update `docs/snapshot/proof-matrices.md` with real Node app presets.
- [x] Update `docs/snapshot/support-envelope.md` with exactly what real Node app
      behavior is supported.
- [x] Update `docs/snapshot/portable-machine-proof-profiles.md` with real Node app
      profile semantics.

## Validation checklist

Run and record timings for:

- [x] proof profile schema validation;
- [x] runtime support matrix validation;
- [x] focused Node smoke runner tests;
- [x] each individual real Node app workload;
- [x] `node-real-apps-positive` matrix;
- [x] full `node-real-apps` matrix;
- [x] full Node matrix;
- [x] full refusal matrix with checked summaries;
- [x] foundation matrix with checked summaries;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] full smoke tests with
      `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` unless the
      implementation demonstrably does not touch VM/VMM/rootfs/assets/CLI,
      snapshot/restore behavior, virtio devices, memory/ballooning, or FUSE/live
      mounts. If skipped, explain why and list targeted E2E validation.

## Completion record

Implemented the proof-backed real Node application smoke suite. The suite adds
tracked Node application harnesses and source fixtures for all ten required
workloads: CLI, CommonJS, ESM, timers/async, fs/stdio, HTTP/TCP, UDP/DNS, worker
thread, native addon/N-API, and crypto/TLS. Each workload has a
`runtime:node:app:*` supported proof profile, concrete positive descriptor
fixture, live source-capture record, app harness JSON, target output sentinel, and
normal target-native restore gates with forbidden success paths set to false.

Implemented artifacts:

- `packages/microvm/test-fixtures/proof-assets/node-application-support-harness.mjs`;
- 10 real Node app harnesses under `docs/snapshot/app-harnesses/`;
- 10 `runtime:node:app:*` positive proof profiles;
- 10 concrete positive descriptor fixture records;
- 10 live source-capture fixture records;
- `node-apps` and `node-apps-supported` proof matrix presets;
- Node runtime manifest entries for all 10 app capabilities;
- support envelope, proof profile, proof matrix, and focused runtime matrix test
  updates.

The final Node support inventory now has 281 supported Node profiles and 0
`runtime:node:*` refusal profiles. The global inventory has 2121 profiles total:
637 expected successes and 1484 expected refusals.

Artifact hashes:

- Node runtime manifest sha256:
  `0965640f8371db81e3b572b063981b15b1d067ee43b2e3bc897838b78c55a9f5`;
- live source-capture fixture registry sha256:
  `356fe93f2ea2d329ce2a10cc50c8aa5f231818da003db6f3f9a1982ba926cc65`;
- positive descriptor fixture registry sha256:
  `5713dca733d91e906db2f446581702946279b367e041bb00e265d8be55aa1520`;
- proof profile inventory sha256:
  `5607759b12e7bbdbb9623fd5b0a72a5e78668e13a5a417d9d3747d72e3bb31aa`.

Validation timings:

- proof profile schema validation — 0.060s;
- runtime support matrix validation — 0.031s;
- focused proof runner/runtime-support tests — 4.303s, 84 tests passed;
- `node-apps-supported` matrix — 0.430s, 10/10 profiles passed;
- `node-apps` matrix — 0.435s, 10/10 profiles passed;
- `node-refusal` matrix — 0.066s, 0 remaining profiles;
- `node-positive` matrix — 11.280s, 281/281 profiles passed;
- full `node` matrix — 11.603s, 281/281 profiles passed;
- full refusal matrix — 61.783s, 1484/1484 profiles passed;
- foundation matrix with checked summaries — 63.175s, 2121/2121 profiles passed;
- `pnpm run format:check` — 1.187s;
- `pnpm run lint` — 0.219s;
- `pnpm run build:docs` — 1.707s;
- `pnpm run typecheck` — 2.370s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.128s;
- `pnpm exec fallow audit --changed-since origin/main` — 0.399s;
- `git diff --check` — 0.048s.

Full smoke tests were not run because this pass added app harness/proof metadata,
source-capture fixtures, descriptor fixtures, matrix selection, docs, and tests;
it did not change VM/VMM/rootfs/base assets, CLI lifecycle, actual
snapshot/restore loader behavior, virtio devices, memory/ballooning, or FUSE/live
mounts. The targeted Node app matrices and runtime harness validation cover the
new proof-backed Node app behavior.

## Completion criteria

Goal 30 is complete only when all ten real Node app workloads pass through the
actual end-to-end capture/restore proof path, app behavior is verified on the
target, matrices and docs are updated, artifact hashes and timings are recorded,
all required validation passes, and no Node app success path depends on emulation,
source text replay, sidecars, application hooks, or hidden helpers.
