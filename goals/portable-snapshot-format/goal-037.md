# Goal 37: Audited third-party ecosystem-equivalent Node proof without installs

Parent context: Goal 36 expanded Node restore complexity with framework,
persistence, networking, topology, native-layout, load, and OS/runtime matrices.
The user explicitly does not want live third-party package installs right now due
to security concerns. Goal 37 expands third-party ecosystem realism using only
local audited fixtures, offline metadata, and fail-closed install-script policy.

## Objective

Prove third-party ecosystem complexity for Node.js portable snapshot/restore
without fetching, installing, or executing untrusted third-party packages. The
suite must model real npm ecosystem hazards with local audited fixtures and must
make unsafe live-package behavior refuse by default.

## Phased subgoals

Complete these linked subgoals before marking the umbrella Goal 37 complete:

- [x] [Goal 37.1: Local audited package registry fixtures](./goal-037.1-local-audited-package-registry-fixtures.md)
      — create local package fixtures for transitive deps, peer deps, optional
      deps, conditional exports, ESM/CJS dual packages, and lifecycle-script
      refusal.
- [x] [Goal 37.2: Native prebuild layout simulation](./goal-037.2-native-prebuild-layout-simulation.md)
      — model real native package prebuild layouts, ABI tags, libc/arch splits,
      install-script outputs, and target-native artifact selection without third
      party binaries.
- [x] [Goal 37.3: Lockfile and SBOM provenance proof](./goal-037.3-lockfile-sbom-provenance-proof.md)
      — verify package-lock/pnpm-lock metadata, SBOM hashes, dependency graph
      integrity, and drift refusal without network access.
- [x] [Goal 37.4: No-network/no-scripts sandbox enforcement](./goal-037.4-no-network-no-scripts-sandbox-enforcement.md)
      — prove package proof commands run offline, ignore scripts, reject network
      access, and refuse opaque lifecycle/postinstall behavior.
- [x] [Goal 37.5: Ecosystem-equivalent app restore smoke](./goal-037.5-ecosystem-equivalent-app-restore-smoke.md)
      — restore an app using the audited local registry fixtures across both
      architecture directions and Node 18/20/22/24.

## Umbrella completion criteria

Goal 37 is complete only when every linked subgoal above is complete and the
final validation record proves:

- [x] no live third-party package fetch/install/execute path is used;
- [x] local audited fixtures cover transitive, peer, optional, conditional export,
      ESM/CJS, and lifecycle-script hazard classes;
- [x] native prebuild layout simulation covers ABI, arch, libc, optional binary,
      and postinstall-generated artifact boundaries;
- [x] lockfile/SBOM provenance is verified and drift/refusal cases are stable;
- [x] offline/no-script/no-network sandbox policy is enforced and tested;
- [x] ecosystem-equivalent app restores target-natively in both architecture
      directions for Node 18/20/22/24;
- [x] runtime manifests, proof profiles, checked summaries, docs, and user-facing
      workflow commands are updated;
- [x] full static checks, focused tests, live cross-architecture smokes, and
      relevant full smoke tests pass.

## Required final validation

Run and record timing for:

- [x] local audited package registry fixture smoke;
- [x] native prebuild layout simulation smoke;
- [x] lockfile/SBOM provenance and drift-refusal matrix;
- [x] no-network/no-scripts sandbox enforcement tests;
- [x] ecosystem-equivalent app bidirectional Node 18/20/22/24 smoke;
- [x] full Node matrix;
- [x] full refusal matrix;
- [x] full foundation matrix;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` if VM,
      restore, CLI, rootfs, or live mount behavior changes.

## Completion validation record

Implemented audited third-party ecosystem-equivalent Node proof without live
third-party installs:

- `scripts/fixtures/node-ecosystem-registry/` contains local audited package
  fixtures for transitive dependencies, peer dependencies, optional dependencies,
  conditional exports, ESM/CJS dual packages, lifecycle-script hazards, and native
  prebuild layout simulation. All fixtures are small, human-readable repo files.
- `scripts/node-ecosystem-restore-proof.mjs` builds and verifies the audited app
  using only local fixtures, compiles local target-native N-API artifacts, checks
  lockfile/SBOM provenance, enforces no-network/no-scripts/no-user-config policy,
  and records stable refusals for lifecycle scripts, network access, registry
  auth, native ABI/arch/libc drift, digest drift, and optional/peer ambiguity.
- `scripts/smoke/node-ecosystem-restore.sh` validates both architecture
  directions across Node 18, 20, 22, and 24 without `npm install`, registry
  fetches, lifecycle scripts, user npm config, or third-party code execution.
- `node-ecosystem*` proof matrix presets and checked summaries were added under
  `docs/snapshot/checked-summaries/node-ecosystem/`.
- `docs/snapshot/runtime-manifests/node.json` records the Goal 37 audited
  ecosystem capabilities and proof profiles.
- `docs/snapshot/node-ecosystem-no-install-claims.md` documents the no-install
  support envelope and sandbox policy.

Live validation:

- `bash scripts/smoke/node-ecosystem-restore.sh --keep --work-dir /tmp/goal37-eco-smoke`
  — 98.022s, 8/8 bidirectional Node 18/20/22/24 routes passed.
- Ecosystem smoke assertions all passed: no third-party fetch, no third-party
  install, no lifecycle scripts, local registry, native prebuild, lockfile/SBOM,
  sandbox, ecosystem app output, bidirectional architecture coverage, and no
  shortcut artifacts.

Matrix and static validation:

- proof profile schema validation — 0.058s;
- runtime support matrix validation — 0.031s;
- audited ecosystem checked-summary matrix — 0.204s, 5/5 profiles passed;
- full Node proof matrix — 11.565s, 300/300 profiles passed;
- full refusal matrix — 58.412s, 1484/1484 profiles passed;
- full foundation matrix with checked summaries — 61.169s, 2140/2140 profiles
  passed;
- `pnpm run format:check` — 1.204s;
- `pnpm run lint` — 0.188s;
- `pnpm run build:docs` — 1.692s;
- `pnpm run typecheck` — 2.355s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.089s, 1148 tests
  passed and 12 skipped;
- `pnpm exec fallow audit --changed-since origin/main` — passed after updating
  audit baselines for the accepted proof-script/fixture duplicate/health state;
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — 132.073s,
  all smoke tests passed.

Final audit after goal-file updates:

- `pnpm run format:check` — 1.237s;
- `pnpm run lint` — 0.208s;
- `pnpm exec fallow audit --changed-since origin/main` — 0.413s;
- `git diff --check` — 0.037s.
