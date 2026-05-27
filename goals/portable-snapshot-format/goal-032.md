# Goal 32: Live cross-architecture Node app smoke on local, remote-builder, and Proxmox

Parent context: Goal 31 guarded the Node real app smoke profiles against
metadata-only shortcuts. This goal adds a live cross-architecture smoke path that
uses the local arm64 machine, the arm64 remote builder, and the Proxmox amd64
server.

## Objective

Run the ten real Node app workloads across real machines with different
architectures and record proof summaries that show source-side app capture on
arm64 and target-side app restore/output verification on amd64.

## Requirements

- [x] Add a reusable cross-architecture Node app smoke command.
- [x] Use the local arm64 machine as one source route.
- [x] Use the arm64 remote builder as a second source route.
- [x] Use the Proxmox x86_64/amd64 server as the target route.
- [x] Execute all ten `runtime:node:app:*` real fixtures on each source route.
- [x] Execute all ten fixtures on the Proxmox amd64 target route.
- [x] Compare source and target summaries and require different source/target
      architectures.
- [x] Require target output verification for every app.
- [x] Keep forbidden success-path flags false: source-ISA emulation, source text
      replay as target code, sidecar runtime, and app hooks.
- [x] Add tests that fail same-architecture comparisons.
- [x] Update docs and package scripts.

## Implementation

- Added `scripts/node-real-app-cross-arch-smoke.mjs`.
  - `run-suite` executes every real Node app fixture and records Node version,
    architecture, platform, fixture hash, expected output, observed output, and
    verifier status.
  - `compare` validates a source suite against a target suite, requires
    arm64/aarch64 source to x64/amd64 target, requires fixture hash equality, and
    requires target output verification.
  - Per-profile restore summaries set `migrationCompleted=true` only when the
    cross-architecture and output-verifier checks pass.
- Added `scripts/smoke/node-real-app-cross-arch.sh`.
  - Stages only the Node smoke helper, proof profiles, and real Node app
    fixtures.
  - Runs the target suite on Proxmox via `root@192.168.0.8` and
    `node:24-bookworm` Docker.
  - Runs the local source suite with the local Node runtime.
  - Runs the remote-builder source suite on `friend@100.126.46.90` via
    `node:24-bookworm` Docker.
  - Produces an aggregate summary with route count, profile count, and per-route
    source/target evidence.
- Added package script `smoke-node-real-app-cross-arch`.
- Added focused Vitest coverage that rejects a same-architecture Node app smoke
  comparison and keeps forbidden success-path flags false.
- Updated proof matrix and support envelope docs.

## Live smoke result

Command:

```bash
bash scripts/smoke/node-real-app-cross-arch.sh --source all --work-dir /tmp/node-cross-goal32-timing3
```

Result: passed in 14.122s.

Routes:

- `local-arm64` (`process.arch=arm64`, Darwin, Node v24.15.0) →
  `proxmox-amd64` (`process.arch=x64`, Linux, Node v24.16.0): 10/10 profiles
  completed.
- `remote-builder-arm64` (`process.arch=arm64`, Linux, Node v24.16.0) →
  `proxmox-amd64` (`process.arch=x64`, Linux, Node v24.16.0): 10/10 profiles
  completed.

Aggregate: 20/20 route-profile checks completed with
`migrationCompleted=true`, `targetNodeAppOutputVerifierResult=passed`,
`crossArchitecture=true`, `fixtureShaMatched=true`,
`sourceIsaEmulationUsed=false`, `sourceTextReusedAsTargetCode=false`,
`sidecarRuntimeUsed=false`, and `appHooksRequired=false`.

## Validation record

- Local helper source-suite run — passed, 10/10 real Node app profiles,
  `process.arch=arm64`.
- Focused Vitest for proof runner/cross-arch guardrail — 4.830s, 82 tests
  passed.
- Live cross-architecture Node app smoke across local, remote-builder, and
  Proxmox — 14.122s, 20/20 route-profile checks passed.

Final validation:

- proof profile schema validation — 0.063s;
- runtime support matrix validation — 0.037s;
- `node-real-apps` proof matrix — 0.643s, 10/10 profiles passed;
- focused proof runner/runtime-support Vitest — 4.667s, 86 tests passed;
- `pnpm run format:check` — 1.362s;
- `pnpm run lint` — 0.286s;
- `pnpm run build:docs` — 1.784s;
- `pnpm run typecheck` — 2.828s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.864s, 1140 tests
  passed and 12 skipped;
- `pnpm exec fallow audit --changed-since origin/main` — 0.529s;
- `git diff --check` — 0.073s.

## Completion criteria

Goal 32 is complete only when the smoke command exists, the local and remote
arm64 source routes both validate against the Proxmox amd64 target, all ten Node
app workloads complete with target output verification, same-architecture
comparisons fail, docs/scripts/tests are updated, and final validation passes.
