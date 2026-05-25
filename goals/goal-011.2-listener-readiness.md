# Goal 11.2: listener readiness with target-side probe

Parent: [`goal-011.md`](./goal-011.md), Track 3. Depends on
[`goal-011.1-tcp-listener.md`](./goal-011.1-tcp-listener.md).

## Objective

Prove readiness composition for a restored loopback listener without treating the
probe client as captured app state. The restored listener must start with no
queued accepted connection, then become ready only because the target verifier
creates a target-side probe client.

## Workload shape

- Builds on the Goal 11.1 listener state.
- Initial listener has no queued accepted connection at capture.
- Target verifier first proves the restored listener is initially not ready.
- Target verifier then creates a target-side probe client and proves readiness.
- Probe client is verifier input only, not migrated app state.
- No edge-triggered/one-shot readiness or scheduler ordering claims.

## Tasks

- [x] Add real verifier flow for listener not-ready then target-generated ready.
- [x] Add target-side probe client strictly inside verifier/proof harness.
- [x] Add gates for initial not-ready state, post-probe readiness, data payload
      if applicable, no unexpected events, and no source queued accept.
- [x] Add positive proof profile `real-tcp-listener-readiness-recreate`.
- [x] Add nearby negative profiles/tests for queued accepts, in-flight accept,
      non-listener sockets, edge-triggered readiness, listener aliases, and
      scheduler ambiguity.
- [x] Update docs/support matrices with the exact accepted readiness subset and
      refusal boundaries.

## Proof requirements

Done only when:

- readiness is proven entirely by target-native verifier actions;
- no captured probe client or source-side connection is needed for success;
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
- focused socket/readiness tests;
- remote arm64->amd64 proof for `real-tcp-listener-readiness-recreate`;
- refusal matrix;
- foundation matrix;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run typecheck`;
- `pnpm run build:docs` if public docs/API changed;
- `pnpm exec fallow audit --changed-since origin/main`;
- full smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior changed.

## Completed proof

- profile: `real-tcp-listener-readiness-recreate`;
- fixture: `packages/microvm/assets/native-tcp-listener-target.c`;
- remote source: `friend@100.126.46.90` (`aarch64`);
- remote target: `root@192.168.0.8` (`x86_64`);
- continuation sha256: `0a49146e533914cf68f335247f3a5b43639cb96ce3544466095b46926a48f9c5`;
- descriptor sha256: `30bda3d09e1c986119b1bb5978913703f9527ce949df91ce2ae0204bef45c3fd`;
- validation timing: 35.397s, passed.

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
