# Goal 11.1: real loopback TCP listener restore proof

Parent: [`goal-011.md`](./goal-011.md), Track 2.

## Objective

Prove the first network-shaped real workload: capture a real arm64 process with
one loopback TCP listener and restore it as a new target-native amd64 listener in
the VM. This goal does **not** support accepted connections, queued accepts, or
readiness claims beyond the listener state itself.

## Workload shape

- Small C workload, not runtime-specific.
- Exactly one IPv4 loopback TCP listener.
- Bind to `127.0.0.1:0` with target-assigned ephemeral remap, or exact loopback
  port reuse only when policy explicitly permits it.
- Bounded modeled backlog.
- Only declared socket options, e.g. `SO_REUSEADDR` if needed.
- No accepted connections.
- Empty accept queue proof.
- No in-flight `accept`/`accept4`.
- No fd aliases, namespaces, credentials, BPF filters, unsupported options, or
  active transport state.

## Tasks

- [x] Add real source fixture for loopback TCP listener capture.
- [x] Capture/classify the socket as `listening`, not connected, queued, or
      in-flight accept.
- [x] Emit portable fields for family, bind address, source port, target
      port/remap policy, backlog, allowed options, close-on-exec/nonblocking
      flags, and empty accept queue proof.
- [x] Recreate target-native socket with `socket()`, modeled `setsockopt()`,
      `bind()`, `listen()`, and fd flag restore.
- [x] Add verifier gates for `SO_ACCEPTCONN`, local address/port/remap, backlog
      policy, allowed options, fd flags, and no accepted peers.
- [x] Add positive proof profile `real-tcp-listener-recreate`.
- [x] Add nearby negative profiles/tests for active accepted connection, queued
      accept, in-flight accept, unsupported options, non-loopback bind without
      policy, fd alias, namespace/credential ambiguity, and socket readiness
      claims not covered by Goal 11.2.
- [x] Update docs/support matrices with the exact accepted subset and refusal
      boundaries.

## Proof requirements

Done only when:

- a real arm64 listener workload restores on amd64 with target-native completion;
- `migrationCompleted=true` is set only after descriptor/resource gates and all
  target verifiers pass;
- no source-ISA emulation, runtime sidecar success, app hooks, or source text
  replay are used;
- provenance records guest arch, kernel/rootfs/VMM/helper hashes, continuation
  hash, descriptor hash, tool versions, and remote host details;
- unsupported neighboring states refuse with stable codes and
  `migrationCompleted=false`.

## Required validation

Record timings for every command/proof:

- schema validation for proof profiles;
- focused resource/socket tests;
- remote arm64->amd64 proof for `real-tcp-listener-recreate`;
- refusal matrix;
- foundation matrix;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run typecheck`;
- `pnpm run build:docs` if public docs/API changed;
- `pnpm exec fallow audit --changed-since origin/main`;
- full smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior changed.

## Completed proof

- profile: `real-tcp-listener-recreate`;
- fixture: `packages/microvm/test-fixtures/proof-assets/native-tcp-listener-target.c`;
- remote source: `friend@100.126.46.90` (`aarch64`);
- remote target: `root@192.168.0.8` (`x86_64`);
- continuation sha256: `c61609289e6a5af6161115e71ac912839284fc21c1121711ec131f6de5dd87b1`;
- descriptor sha256: `f31b745fd4cc46254567de9937ed597cf4041c6fdedb6fab834ff942ac94a293`;
- validation timing: 36.366s, passed.

## Shared validation

All Goal 11.1-11.4 validation completed with timings:

- `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`: 0.199s, passed.
- `pnpm --silent portable-machine-proof-matrix -- --preset refusal --json --continue-on-fail`: 2.604s, passed (102 refusal profiles, including `raw-icmp-ping-refusal`).
- `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-11-subgoals-final2 --json --continue-on-fail`: 3.354s, passed (137 profiles; 35 success, 102 refusal).
- Full unit tests (`NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`): 27.323s, passed.
- `pnpm run format:check`: 0.639s, passed.
- `pnpm run lint`: 0.208s, passed.
- `pnpm run build:docs`: 1.693s, passed.
- `pnpm run typecheck`: 2.294s, passed.
- `pnpm exec fallow audit --changed-since origin/main`: 0.392s, passed with the existing duplicate-import warning only.
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`: 133.019s, passed.
