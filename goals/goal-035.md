# Goal 35: Expanded Node.js cross-architecture restore claims

Parent context: Goal 34 proved a production-shaped Node.js restore envelope for
specific app shapes and arm64 -> amd64 routes. Goal 35 targets the claims that
Goal 34 explicitly did **not** make.

## Objective

Convert the remaining Node.js cross-architecture restore non-claims into
proof-backed support envelopes or stable fail-closed refusal envelopes. A claim is
not considered supported until a live source capture and target-native restore
prove it without source-ISA emulation, source text replay, sidecar runtimes, or
app hooks.

## Phased subgoals

Complete these linked subgoals before marking the umbrella Goal 35 complete:

- [x] [Goal 35.1: Arbitrary existing Node process capture](./goal-035.1-arbitrary-existing-node-processes.md)
      — attach to already-running Node processes, discover their runtime state,
      and prove restore or refusal without requiring a purpose-built app harness.
- [x] [Goal 35.2: Live active HTTP/TCP connection preservation](./goal-035.2-live-active-http-tcp-preservation.md)
      — preserve real in-flight HTTP/TCP connections across restore, or narrow
      the claim with explicit packet/socket/TLS refusal boundaries.
- [x] [Goal 35.3: Child process and IPC trees](./goal-035.3-child-process-ipc-trees.md)
      — handle Node processes with child processes, pipes, IPC channels, stdio,
      and process-tree lifecycle semantics.
- [x] [Goal 35.4: Inspector and debugging sessions](./goal-035.4-inspector-debugging-sessions.md)
      — support or refuse active Node inspector/debug sessions with stable
      protocol-state evidence.
- [x] [Goal 35.5: Ambiguous dirty persistent state](./goal-035.5-ambiguous-dirty-persistent-state.md)
      — resolve or fail closed for dirty files, mmap state, databases, locks,
      fsync gaps, and ambiguous external durability.
- [x] [Goal 35.6: Broad native addon and ABI coverage](./goal-035.6-broad-native-addon-abi-coverage.md)
      — expand beyond the single proof addon to real N-API, V8 ABI, libc,
      dynamically-linked, and architecture-specific native addon cases.
- [x] [Goal 35.7: amd64 source to arm64 target route](./goal-035.7-amd64-to-arm64-route.md)
      — prove the reverse architecture direction with live amd64 source capture
      and arm64 target-native restore.

## Umbrella completion criteria

Goal 35 is complete only when every linked subgoal above is complete and the
final validation record proves:

- [x] existing arbitrary Node processes are either restored or refused from live
      process inspection, not curated metadata;
- [x] active HTTP/TCP connection preservation is supported for the claimed
      subset, with packet/socket/TLS neighbor refusals where unsafe;
- [x] child-process and IPC process trees are restored or refused with stable
      codes and no orphaned resources;
- [x] inspector/debug sessions are restored or refused based on concrete
      protocol-state fixtures;
- [x] ambiguous dirty persistent state has explicit durability semantics or
      fail-closed refusal codes;
- [x] native addon and ABI support covers a broad representative matrix and
      refuses mismatches deterministically;
- [x] amd64 -> arm64 works with target-native arm64 execution and no source-ISA
      emulation;
- [x] all new claims have checked summaries, runtime manifests, proof matrices,
      and user-facing docs;
- [x] full static checks, focused tests, live cross-architecture smokes, and
      relevant full smoke tests pass.

## Required final validation

Run and record timing for:

- [x] arbitrary existing Node process live capture/restore smoke;
- [x] active HTTP/TCP preservation smoke with in-flight request verification;
- [x] active HTTP/TCP unsafe-neighbor refusal matrix;
- [x] child process + IPC restore/refusal smoke;
- [x] inspector/debug session restore/refusal smoke;
- [x] ambiguous dirty persistent state restore/refusal smoke;
- [x] broad native addon/ABI matrix;
- [x] amd64 source -> arm64 target live restore smoke;
- [x] reverse-route Node version matrix for Node 20/22/24;
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

Implemented the expanded Node.js cross-architecture restore proof envelope:

- `scripts/node-expanded-restore-proof.mjs` performs live source discovery and
  target proof summaries for already-running Node processes, active HTTP/TCP
  preservation, child process/IPC trees, inspector-state policy, dirty
  persistent-state durability semantics, broad native addon/ABI provenance, and
  amd64 -> arm64 route verification.
- `scripts/smoke/node-expanded-restore.sh` validates Proxmox amd64 source
  capture to remote-builder arm64 target-native restore for Node 20, 22, and 24.
- `node-expanded*` matrix presets and checked summaries were added under
  `docs/snapshot/checked-summaries/node-expanded/`.
- `docs/snapshot/runtime-manifests/node.json` now records the Goal 35 expanded
  capabilities and positive proof profiles.
- `docs/snapshot/node-expanded-restore-claims.md` documents the supported subset
  and stable refusal boundaries.

Live validation:

- `bash scripts/smoke/node-expanded-restore.sh --keep --work-dir /tmp/goal35-expanded-final`
  — 30.427s, 3/3 amd64 -> arm64 Node 20/22/24 routes passed.
- Expanded smoke assertions all passed: arbitrary existing processes, active
  HTTP/TCP preservation, child process/IPC trees, inspector policy, dirty
  persistent state, broad native addon/ABI, amd64 -> arm64 route, and no shortcut
  artifacts.

Matrix and static validation:

- proof profile schema validation — 0.061s;
- runtime support matrix validation — 0.031s;
- expanded Node checked-summary matrix — 0.261s, 7/7 profiles passed;
- full Node proof matrix — 11.363s, 288/288 profiles passed;
- full refusal matrix — 58.367s, 1484/1484 profiles passed;
- full foundation matrix with checked summaries — 58.507s, 2128/2128 profiles
  passed;
- `pnpm run format:check` — 1.135s;
- `pnpm run lint` — 0.201s;
- `pnpm run build:docs` — 1.637s;
- `pnpm run typecheck` — 2.293s;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.114s, 1144 tests
  passed and 12 skipped;
- `pnpm exec fallow audit --changed-since origin/main` — 0.389s;
- `git diff --check` — 0.033s;
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — 131.190s,
  all smoke tests passed.
