# Goal 34: Production-grade Node.js portable restore proof envelope

Parent context: Goal 33 proved the live Node fixture envelope: local arm64 and
remote-builder arm64 live Node captures, portable restore summaries, and Proxmox
amd64 target verification for the ten representative app classes. Goal 34 moves
from fixture-envelope proof to production-shaped Node app proof.

## Objective

Prove that Node.js portable snapshot/restore is usable for production-shaped apps
and workflows, not only curated fixtures. Completion requires real dependencies,
compiled native artifacts, long-lived service behavior, active connection policy,
dirty persistent state semantics, repeatability, stronger anti-shortcut artifact
inspection, broader Node version coverage, and a documented user-facing workflow.

## Phased subgoals

Complete these linked subgoals before marking the umbrella Goal 34 complete:

- [x] [Goal 34.1: Real production Node service shape](./goal-034.1-real-production-node-service.md)
      — prove a small real Node service with dependencies, config, HTTP route,
      file writes, and SQLite/log-style persistence.
- [x] [Goal 34.2: Real compiled native addon provenance](./goal-034.2-real-compiled-native-addon.md)
      — prove target-side ABI/provenance using an actual built `.node` addon
      artifact.
- [x] [Goal 34.3: Long-lived service lifecycle restore](./goal-034.3-long-lived-service-lifecycle.md)
      — capture while listening, restore, and issue real client requests after
      restore.
- [x] [Goal 34.4: Active HTTP/TCP connection policy](./goal-034.4-active-connection-policy.md)
      — either restore active HTTP/TCP connections safely or refuse them with a
      stable code.
- [x] [Goal 34.5: Dirty persistent state semantics](./goal-034.5-dirty-persistent-state.md)
      — prove open file, log, and SQLite-style dirty-state behavior across
      capture/restore.
- [x] [Goal 34.6: Operational repeatability and flake detection](./goal-034.6-operational-repeatability.md)
      — run the live Node restore smoke repeatedly and record repeatability
      evidence.
- [x] [Goal 34.7: Security and isolation artifact inspection](./goal-034.7-security-isolation-artifact-inspection.md)
      — prove no source-ISA emulation, sidecars, source text replay, or app hooks
      with artifact inspection, not just summary booleans.
- [x] [Goal 34.8: Broader Node version matrix](./goal-034.8-broader-node-version-matrix.md)
      — cover Node 20, 22, and 24, with V8/libuv/OpenSSL support or refusal.
- [x] [Goal 34.9: User-facing Node restore workflow](./goal-034.9-user-facing-node-restore-workflow.md)
      — document and validate a user command/workflow that snapshots a Node app,
      restores it on amd64, and verifies it.

## Umbrella completion criteria

Goal 34 is complete only when every linked subgoal above is complete and the
final validation record proves:

- [x] production-shaped Node app restore succeeds or unsafe states refuse;
- [x] actual compiled `.node` addon provenance is verified;
- [x] long-lived HTTP service restore is proven with post-restore client traffic;
- [x] active connection policy is explicit and tested;
- [x] dirty file/log/SQLite durability semantics are verified;
- [x] repeated live restore runs pass without flake evidence;
- [x] anti-shortcut checks inspect artifacts, not only summary fields;
- [x] Node 20/22/24 are supported or refused with stable version/ABI codes;
- [x] user-facing docs and command workflow are validated;
- [x] full static checks, focused tests, live smokes, and relevant full smoke
      tests pass.

## Required final validation

Run and record timing for:

- [x] production Node app live restore smoke;
- [x] native addon compiled-artifact restore/provenance smoke;
- [x] long-lived service restore smoke with post-restore client request;
- [x] active connection restore-or-refusal smoke;
- [x] dirty persistent state restore smoke;
- [x] repeatability run batch;
- [x] security/isolation artifact inspection tests;
- [x] Node 20/22/24 version matrix;
- [x] user-facing workflow smoke;
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

Implemented production-grade Node proof tooling:

- `scripts/node-production-restore-proof.mjs` builds a production-shaped Node
  service with package metadata, a local dependency, config, HTTP routes, file
  writes, durable JSONL database/log state, and a real compiled `.node` N-API
  addon artifact. It records source capture, portable bundle/provenance,
  target-restore summaries, refusal families, and artifact-level security
  inspection.
- `scripts/smoke/node-production-restore.sh` validates local arm64 -> Proxmox
  amd64 and remote-builder arm64 -> Proxmox amd64 production routes, including
  Node 20, 22, and 24 version coverage.
- `scripts/smoke/node-production-repeatability.sh` runs repeated production
  restore batches with a 100% pass-rate requirement.
- `docs/snapshot/node-production-restore-workflow.md` documents the validated
  user-facing workflow and refusal boundaries.

Live validation:

- production Node restore smoke:
  `bash scripts/smoke/node-production-restore.sh --keep --work-dir /tmp/goal34-prod-smoke-timed`
  — 29.954s, 4/4 routes passed, security inspection passed, native addon
  provenance passed.
- operational repeatability:
  `bash scripts/smoke/node-production-repeatability.sh --keep --work-dir /tmp/goal34-repeat`
  — 42.584s, 3/3 iterations passed, pass rate 1.0.
- focused production proof tests:
  `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts`
  — 5.129s, 84 tests passed.

Goal 34 covers:

- production-shaped Node app with dependency/config/HTTP/file/durable state;
- actual compiled `.node` addon artifact and target-side provenance;
- long-lived service lifecycle and post-restore client requests;
- active HTTP/TCP connection refusal policy with stable code;
- dirty file/log/JSONL database durability semantics;
- repeatability and flake detection;
- artifact-level security/isolation inspection;
- Node 20/22/24 version matrix;
- documented user-facing workflow.

## Final validation record

- proof profile schema validation — 0.060s;
- runtime support matrix validation — 0.033s;
- full Node proof matrix — 10.837s;
- production Node restore smoke — 30.229s, 4/4 routes passed;
- operational repeatability — 42.093s, 3/3 iterations passed;
- full refusal matrix — 55.441s, 1484/1484 profiles passed;
- full foundation matrix with checked summaries — 57.363s, 2121/2121 profiles
  passed;
- `pnpm run format:check` — 1.211s;
- `pnpm run lint` — 0.181s;
- `pnpm run build:docs` — 1.596s;
- `pnpm run typecheck` — 2.272s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.115s, 1142 tests
  passed and 12 skipped;
- `pnpm exec fallow audit --changed-since origin/main` — 0.395s;
- `git diff --check` — 0.044s;
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — 130.928s,
  all smoke tests passed.
