# Goal 46: Productize remaining cross-architecture proof and refusal envelopes

Parent context: Goal 45 productized the first real `amd64 <-> arm64` path:
clean/quiesced PostgreSQL logical state. Goals 1-44 contain the broader proof and
refusal history: early portable snapshot format work, native process capture,
register/stack/memory/resource translation, target guest restore proofs,
portable-machine proof matrices, Node.js, Go, Python, Ruby, JVM, stateful
services, native Linux resources, sockets, ping/ICMP, futexes, epoll, timers,
namespaces, signals, and other kernel/runtime state. Those remain proof-only or
refusal-only until they are wired into product capture/restore surfaces with
target-native verification.

## Objective

Turn every remaining cross-architecture proof or refusal family into an explicit
product status:

- implemented product support;
- stable product refusal;
- proof-only fixture retained for research/regression coverage;
- obsolete/invalid claim removed or corrected.

This goal is complete only when users can ask Machinen, through product CLI/API
surfaces, whether each known runtime/resource/service state is supported or
refused, and receive a stable machine-readable answer. Positive support requires
real product capture/restore and target-native verification. Refusals require
stable codes, actionable messages, and `migrationCompleted=false`.

## Scope

Productize or explicitly product-refuse every pre-Goal-45 family, including the
early Goals 1-32 foundation/native/portable-machine work and every non-PostgreSQL
Goal 33-44 family. The scope includes at least:

- Node.js live, production, expanded, complex, ecosystem/no-install, native addon,
  workers, async/timers, module graph, V8 heap, signals, filesystem/stdio,
  networking, HTTP/TCP, WebSocket, TLS/keepalive, cluster/supervisor, and package
  provenance states.
- Go quiescent service/runtime states, Go scheduler boundaries, channels,
  goroutines, timers, netpoll, and cgo refusals.
- Python, Ruby, JVM, and broader non-Node runtime envelopes and native extension
  refusals.
- Redis, SQLite, MySQL/MariaDB, durable queues, filesystem-backed state patterns,
  append-only logs, checkpoint/atomic-rename patterns, mmap/lock/unsynced state,
  and host-mounted ambiguity.
- Early portable-snapshot/native foundation work from Goals 1-32: portable
  descriptor schemas, native process capture, register translation, code maps,
  DWARF/unwind metadata, return-chain/frame/stack translation, private memory,
  mapping materialization, executable/material/resource recipes, synthetic and
  real-utility continuations, active syscall policies, target guest restore
  loader/plans, VM restore proof harnesses, invalidation/stale descriptor
  boundaries, and proof-runner/profile matrix infrastructure.
- Native/Linux resource families already represented in proof/refusal matrices:
  pipes, eventfd, timerfd, futex/restart-block/rseq, shared memory, memfd,
  inotify/fanotify, io_uring, pidfd/clone/seccomp/landlock/cgroups/scheduler,
  namespaces, rlimits, prctl/personality/umask/cwd/root/mount/user/network/UTS/IPC
  state, SysV IPC, terminal/PTY/termios, signalfd/signals/timers, epoll, sockets,
  TCP listener/accept/broker states, raw ICMP, ping sockets, ICMPv6, BPF filters,
  and ancillary packet/control-message state.

## Guardrails

- Do not broaden Goal 45's PostgreSQL product claim by implication.
- Do not claim arbitrary VM memory/device/CPU snapshot portability across ISAs.
- Do not accept source-ISA emulation, source text replay, sidecar runtime
  success, app hooks, metadata-only continuation, or host-specific byte-copy as
  support.
- Every positive product claim must use an explicit portable-state descriptor,
  product capture surface, product restore surface, integrity/provenance checks,
  and target-native verifier.
- Every unsupported or ambiguous state must refuse before restore side effects
  where possible and must keep `migrationCompleted=false`.
- Proof-only fixtures may remain, but docs, manifests, CLI/API output, checked
  summaries, and matrices must never present them as product support.

## Phased subgoals

Create and complete linked subgoals for the families below before marking Goal 46
complete:

- [x] [Goal 46.1: Node.js product support/refusal surfaces](./goal-046.1-nodejs-product-status.md).
- [x] [Goal 46.2: Go product support/refusal surfaces](./goal-046.2-go-product-status.md).
- [x] [Goal 46.3: Python/Ruby/JVM product support/refusal surfaces](./goal-046.3-python-ruby-jvm-product-status.md).
- [x] [Goal 46.4: Stateful service product support/refusal surfaces beyond
      PostgreSQL](./goal-046.4-stateful-services-product-status.md).
- [x] [Goal 46.5: Early foundation, native process, descriptor, target-loader,
      and portable-machine product support/refusal surfaces](./goal-046.5-foundation-native-product-status.md).
- [x] [Goal 46.5b: Native Linux resource product support/refusal surfaces](./goal-046.5b-native-linux-resource-product-status.md).
- [x] [Goal 46.6: Network, ping, ICMP, TCP, TLS, BPF, epoll, and socket-state
      product support/refusal surfaces](./goal-046.6-network-ping-socket-product-status.md).
- [x] [Goal 46.7: Global product claim registry, CLI/API discovery, docs, and
      upgrade/remediation guidance](./goal-046.7-global-product-claim-registry.md).

## Requirements

- [x] Extend the product claim inventory introduced by Goal 45 so every known
      proof/refusal profile from Goals 1-44 and the portable-machine proof matrix
      has a product status.
- [x] Add a user-facing discovery command/API that reports support/refusal status
      by runtime, resource family, architecture route, unsafe-state family,
      refusal code, and graduation requirements.
- [x] For each family selected for product support, implement product capture and
      restore descriptors instead of relying on proof-only harness summaries.
- [x] For each family not selected for support, implement product refusals with
      stable codes, actionable messages, and no restore success path.
- [x] Add regression tests that fail if any proof-only profile, dry-run proof,
      checked summary, or research fixture is reported as implemented product
      support.
- [x] Add tamper/integrity/version/architecture-mismatch tests for every new
      descriptor family.
- [x] Preserve existing stable refusal codes unless a deliberate migration map is
      documented and tested.
- [x] Update checked summaries, proof matrices, runtime manifests, docs, API
      docs, CLI help/completions, and user guidance.
- [x] Re-run relevant proof matrices and compare product claim registry output
      against proof/refusal provenance.
- [x] Run full VM smoke tests for any VM/rootfs/CLI/snapshot/restore/live-mount
      behavior change.

## Required final validation

Run and record timing for:

- [x] Node.js product support/refusal smoke and claim matrix;
- [x] Go product support/refusal smoke and claim matrix;
- [x] Python/Ruby/JVM product support/refusal smoke and claim matrix;
- [x] stateful services product support/refusal smoke and claim matrix;
- [x] early foundation/native descriptor/target-loader/portable-machine product
      support/refusal smoke and claim matrix;
- [x] native Linux resource product support/refusal smoke and claim matrix;
- [x] network/ping/ICMP/TCP/TLS/BPF/epoll/socket product support/refusal smoke and
      claim matrix;
- [x] global product claim registry matrix;
- [x] proof-vs-product regression matrix across all Goals 1-44 profiles;
- [x] relevant runtime/service proof matrices for every graduated product subset;
- [x] full runtime support matrix;
- [x] full refusal matrix;
- [x] full foundation matrix audit;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` if VM,
      rootfs, CLI, snapshot/restore, or live mount behavior changes.

## Completion criteria

Complete when every remaining cross-architecture proof/refusal family has a
truthful product status; every supported family has an implemented product
capture/restore path with target-native verification; every unsupported family
has a stable product refusal; ping/ICMP and all other native resource refusals are
visible through product discovery; pre-33 foundation/native proof claims are also
classified; and users can no longer confuse proof-only feasibility with
implemented Machinen support.

## Completion record

Implemented Goal 46 as a global product-status registry and discovery surface:

- Runtime API: `packages/runtime/src/product-claim-registry.ts` exports
  `buildProductClaimRegistry`, `filterProductClaimRegistry`,
  `productClaimRefusalSummary`, product claim types, family/status constants, and
  the proof-only product refusal code `product-surface-not-implemented`.
- CLI discovery: `machinen support` supports `--family`, `--runtime`, `--status`,
  `--profile`, `--resource-family`, `--refusal-code`, and `--json`.
- Product matrix: `scripts/product-claim-registry-matrix.mjs` validates all 2245
  proof profiles, keeps the Goal 45 PostgreSQL logical route as the only
  implemented product support entry, exposes all proof refusals as stable product
  refusals, and keeps all other positive proofs as proof-only fixtures.
- Smoke: `scripts/smoke/product-support-discovery.sh` verifies discovery for
  Node.js, Go, Python/Ruby/JVM, stateful services, foundation/native,
  native-Linux-resource, network/ping/ICMP/socket, PostgreSQL product support,
  and proof-only filters.
- Docs/API: `docs/snapshot/product-claim-registry.md`,
  `docs/snapshot/proof-matrices.md`, `docs/snapshot/product-portable-postgres.md`,
  `packages/runtime/API.md`, CLI help/completions, and agent-context document the
  registry and user workflow.
- Checked summaries:
  `docs/snapshot/checked-summaries/product-claim-registry/`.

The selected implemented product support set remains intentionally narrow:
Goal 45's `postgres-clean-quiesced-logical-v1`. Every other positive proof is
truthfully surfaced as `proof-only-fixture` and receives the product refusal code
`product-surface-not-implemented`. Every existing proof/refusal profile is
surfaced as `stable-product-refusal` with `migrationCompleted=false` and its
existing stable refusal code where present. Ping/ICMP and socket states are
visible through `machinen support --family network-ping-socket --json`.

Final validation on 2026-05-27:

- `node scripts/product-claim-registry-matrix.mjs --family nodejs --summary /tmp/goal46-nodejs.json`
  — passed in 0.086s; 300 selected.
- `node scripts/product-claim-registry-matrix.mjs --family go --summary /tmp/goal46-go.json`
  — passed in 0.078s; 35 selected.
- `node scripts/product-claim-registry-matrix.mjs --family python-ruby-jvm --summary /tmp/goal46-pyjvm.json`
  — passed in 0.078s; 4 selected.
- `node scripts/product-claim-registry-matrix.mjs --family stateful-services --summary /tmp/goal46-stateful.json`
  — passed in 0.074s; 26 selected.
- `node scripts/product-claim-registry-matrix.mjs --family foundation-native --summary /tmp/goal46-foundation-native.json`
  — passed in 0.075s; 127 selected.
- `node scripts/product-claim-registry-matrix.mjs --family native-linux-resource --summary /tmp/goal46-native-linux.json`
  — passed in 0.077s; 302 selected.
- `node scripts/product-claim-registry-matrix.mjs --family network-ping-socket --summary /tmp/goal46-network.json`
  — passed in 0.078s; 536 selected.
- `node scripts/product-claim-registry-matrix.mjs --summary /tmp/goal46-global.json`
  — passed in 0.074s; 2245 selected.
- `pnpm run smoke-product-support-discovery` — passed in 1.211s.
- `node scripts/portable-machine-proof-matrix.mjs --preset postgres-machinen --check-summary-dir docs/snapshot/checked-summaries/postgres-machinen --json --summary /tmp/goal46-postgres-machinen.json`
  — passed in 0.400s; 10/10 PostgreSQL proof/refusal profiles passed.
- `node scripts/runtime-support-matrix.mjs --json --summary /tmp/goal46-runtime-support.json`
  — passed in 0.053s.
- `node scripts/portable-machine-proof-matrix.mjs --preset refusal --summary /tmp/goal46-refusal.json --json`
  — passed in 67.652s; 1563/1563 refusal profiles passed.
- `PORTABLE_AMD64_REPO=/root/machinen-node-e2e PORTABLE_MACHINE_TARGET_VM_IMAGE=/root/machinen-node-e2e/release-assets/rootfs-debian-amd64.tar.gz PORTABLE_AMD64_ASSETS_DIR=/root/machinen-node-e2e/release-assets node scripts/portable-machine-proof-matrix.mjs --preset foundation-full --summary /tmp/goal46-foundation.json --json`
  — audited in 52.945s; 2244/2245 profiles passed. The sole failure was the
  pre-existing remote `two-thread-ppoll` target VM proof failing before Goal 46
  product code with `target-vm-proof-failed` / `EXEC_AGENT_UNAVAILABLE` on
  `root@192.168.0.8`. Full local VM smoke passed below.
- `pnpm run format:check` — passed in 1.414s.
- `pnpm run lint` — passed in 0.215s.
- `pnpm run build:docs` — passed in 1.744s.
- `pnpm run typecheck` — passed in 2.534s.
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — passed in 49.152s; 1168
  tests passed and 12 skipped.
- `pnpm exec fallow audit --changed-since origin/main` — passed in 0.237s.
- `git diff --check` — passed in 0.022s.
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — passed in
  134.002s; all smoke tests passed.
