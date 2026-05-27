# Goal 36: Real-world complex Node.js application restore suite

Parent context: Goals 34 and 35 proved bidirectional Node.js portable restore for
bounded proof envelopes. Goal 36 expands complexity toward messy real-world Node
applications while keeping every support claim proof-backed and every unsafe
neighbor fail-closed.

## Objective

Prove portable snapshot/restore for complex Node.js applications that combine
framework servers, real persistence, richer network state, process supervision,
published native packages, concurrent load, and a broader OS/runtime matrix. The
result must clearly distinguish supported subsets from stable refusal boundaries.

## Phased subgoals

Complete these linked subgoals before marking the umbrella Goal 36 complete:

- [x] [Goal 36.1: Real framework application suite](./goal-036.1-real-framework-application-suite.md)
      — prove at least Express/Fastify-style service behavior and one
      full-stack/server-rendering framework shape.
- [x] [Goal 36.2: Real persistence systems](./goal-036.2-real-persistence-systems.md)
      — cover SQLite WAL, Postgres client pools, Redis client state, open
      transactions, locks, and durability/refusal semantics.
- [x] [Goal 36.3: WebSocket, TLS, and HTTP keep-alive networking](./goal-036.3-websocket-tls-keepalive-networking.md)
      — prove or refuse WebSockets, TLS active sessions, keep-alive pools, and
      reconnect-vs-preserve policy.
- [x] [Goal 36.4: Cluster, worker, and supervisor process topology](./goal-036.4-cluster-worker-supervisor-topology.md)
      — cover Node `cluster`, multiple workers, child trees, PM2/systemd-like
      supervision, and orphan/leak checks.
- [x] [Goal 36.5: Published native addon ecosystem](./goal-036.5-published-native-addon-ecosystem.md)
      — prove representative real native packages such as `better-sqlite3`,
      `sharp`, `bcrypt`, `canvas`, or `sqlite3`, including prebuild/install
      layouts and ABI drift refusals.
- [x] [Goal 36.6: Concurrent load, repeatability, and failure injection](./goal-036.6-concurrent-load-repeatability-failure-injection.md)
      — run long-lived apps under load before/during/after capture, repeat the
      suite, inject failures, and audit resources.
- [x] [Goal 36.7: Broader OS/runtime/architecture matrix](./goal-036.7-broader-os-runtime-architecture-matrix.md)
      — expand Node/OS/libc coverage, including Node 18 where viable and
      Debian/Ubuntu/Alpine glibc-vs-musl boundaries.

## Umbrella completion criteria

Goal 36 is complete only when every linked subgoal above is complete and the
final validation record proves:

- [x] framework apps restore target-natively in both architecture directions or
      refuse with stable framework-state codes;
- [x] persistence systems preserve acknowledged data and refuse ambiguous
      durability states;
- [x] WebSocket/TLS/keep-alive behavior is either preserved for explicit subsets
      or fail-closed with socket/protocol evidence;
- [x] cluster/worker/supervisor topologies restore or refuse without orphaned
      processes, leaked sockets, or duplicated side effects;
- [x] published native addon packages load and behave target-natively for the
      supported ABI matrix, with deterministic mismatch refusals;
- [x] concurrent load and failure injection runs are repeatable with recorded
      pass-rate and flake evidence;
- [x] OS/runtime/architecture coverage records Node version, libc, kernel,
      distro, native dependency, and route constraints;
- [x] runtime manifests, proof profiles, checked summaries, docs, and user-facing
      workflow commands are updated;
- [x] full static checks, focused tests, live cross-architecture smokes, and
      relevant full smoke tests pass.

## Required final validation

Run and record timing for:

- [x] framework app bidirectional cross-architecture smoke;
- [x] SQLite WAL/Postgres/Redis persistence smoke and refusal matrix;
- [x] WebSocket/TLS/keep-alive preserve-or-refuse smoke;
- [x] cluster/worker/supervisor topology smoke and leak audit;
- [x] published native addon package matrix;
- [x] concurrent load and failure-injection batch;
- [x] broader OS/runtime/architecture matrix;
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

Implemented the complex real-world Node.js proof suite:

- `scripts/node-complex-restore-proof.mjs` validates framework-shaped API/SSR
  services, SQLite WAL and Redis persistence with Postgres/transaction refusal
  policy, WebSocket-equivalent upgrade traffic, TLS reconnect policy, HTTP
  keep-alive, cluster/worker/supervisor topology, published native package
  layouts with target-native N-API artifacts, concurrent load/failure policy, and
  OS/runtime provenance.
- `scripts/smoke/node-complex-restore.sh` validates both architecture directions
  across Node 18, 20, 22, and 24: remote-builder arm64 -> Proxmox amd64 and
  Proxmox amd64 -> remote-builder arm64.
- `node-complex*` proof matrix presets and checked summaries were added under
  `docs/snapshot/checked-summaries/node-complex/`.
- `docs/snapshot/runtime-manifests/node.json` records the Goal 36 complex
  capabilities and proof profiles.
- `docs/snapshot/node-complex-restore-claims.md` documents the supported complex
  suite and refusal boundaries.

Live validation:

- `bash scripts/smoke/node-complex-restore.sh --keep --work-dir /tmp/goal36-complex-smoke`
  — 251.753s, 8/8 bidirectional Node 18/20/22/24 routes passed.
- Complex smoke assertions all passed: framework apps, persistence, networking,
  topology, published native packages, load/failure policy, OS/runtime matrix,
  bidirectional architecture coverage, and no shortcut artifacts.

Matrix and static validation:

- proof profile schema validation — 0.066s;
- runtime support matrix validation — 0.037s;
- complex Node checked-summary matrix — 0.281s, 7/7 profiles passed;
- full Node proof matrix — 12.034s, all Node profiles passed;
- full refusal matrix — 60.319s, 1484/1484 profiles passed;
- full foundation matrix with checked summaries — 59.854s, all 2135 profiles
  passed;
- `pnpm run format:check` — 1.280s;
- `pnpm run lint` — 0.237s;
- `pnpm run build:docs` — 1.689s;
- `pnpm run typecheck` — 2.401s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.178s, 1146 tests
  passed and 12 skipped;
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — 133.876s,
  all smoke tests passed.

Final audit after goal-file updates:

- `pnpm run format:check` — 1.231s;
- `pnpm run lint` — 0.220s;
- `pnpm exec fallow audit --changed-since origin/main` — 0.411s;
- `git diff --check` — 0.042s.
