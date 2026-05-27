# Goal 11.3: explicit-broker active TCP stream proof

Parent: [`goal-011.md`](./goal-011.md), Track 4. Depends on the listener/socket
model from [`goal-011.1-tcp-listener.md`](./goal-011.1-tcp-listener.md).

## Objective

Prove one active plain TCP stream only after the broker is a declared, audited
transport capability. The broker must be visible proof infrastructure, not a
hidden sidecar that makes target process completion look successful.

## Workload shape

- Exactly one established plain TCP connection.
- No TLS/session-layer state.
- Exact endpoint identities, unread bytes, write-buffer policy, half-close state,
  and allowed options.
- Declared broker binary/path/hash/arch/network namespace/mode.
- Target verifier proves read/write/EOF or half-close behavior through the
  declared contract.
- No hidden source-side process dependency.

## Tasks

- [x] Implement real broker provenance capture and validation.
- [x] Fail closed for missing, stale, wrong-arch, undeclared, or namespace
      mismatched brokers.
- [x] Add real target attach/reconnect/relay recipe for the accepted stream.
- [x] Add verifier gates for read/write, EOF/half-close, option state, broker
      provenance, and no source-ISA/sidecar success.
- [x] Add positive proof profile `real-tcp-active-connection-transport-recreate`.
- [x] Add nearby negative profiles/tests for missing broker, TLS/session state,
      unknown options, unread-byte mismatch, half-close mismatch, OOB/urgent
      data, non-TCP sockets, and source-side dependency.
- [x] Update docs/support matrices with the exact accepted brokered-stream subset
      and refusal boundaries.

## Proof requirements

Done only when:

- the broker is declared in the proof artifact with path/hash/arch/namespace/mode;
- target process completion cannot pass through an undeclared or stale broker;
- target verifier proves the stream semantics through the declared contract;
- `migrationCompleted=true` is set only after descriptor/resource gates and all
  target verifiers pass;
- no source-ISA emulation, hidden sidecar success, app hooks, or source text
  replay are used;
- unsupported neighboring states refuse with stable codes and
  `migrationCompleted=false`.

## Required validation

Record timings for every command/proof:

- schema validation for proof profiles;
- focused transport/broker tests;
- remote arm64->amd64 proof for
  `real-tcp-active-connection-transport-recreate`;
- refusal matrix;
- foundation matrix;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run typecheck`;
- `pnpm run build:docs` if public docs/API changed;
- `pnpm exec fallow audit --changed-since origin/main`;
- full smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior changed.

## Completed proof

- profile: `real-tcp-active-connection-transport-recreate`;
- fixture: `packages/microvm/test-fixtures/proof-assets/native-tcp-active-target.c`;
- remote source: `friend@100.126.46.90` (`aarch64`);
- remote target: `root@192.168.0.8` (`x86_64`);
- declared broker: target-loopback peer, amd64, fd 57, proof-verifier-owned, no source dependency;
- continuation sha256: `6bbd158e7eae5147968ca509a80f2b809c411f75e4faa228391ba1416168a915`;
- descriptor sha256: `f1f907397d54b43888b6072b5daf462f19be56acb41276185995b07d0fae15aa`;
- validation timing: 35.522s, passed.

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
