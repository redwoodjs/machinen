# Goal 11.4: raw ICMP / ping portable contract

Parent: [`goal-11.md`](./goal-11.md), Track 5.

## Objective

Keep `ping` and raw ICMP refused unless and until a full raw-socket portable
contract exists. This goal is intentionally not a first networking target: raw
ICMP requires capability, namespace, route, packet, and verifier semantics that a
simple TCP listener does not.

## Current boundary

`raw-icmp-ping-refusal` must remain an explicit refusal until this goal supplies
a real accepted subset. Do not mark `ping` supported by documentation alone.

## Required contract before any positive proof

A future `raw-icmp-v1` contract must define:

- capability policy, including `CAP_NET_RAW` or equivalent target policy;
- network namespace identity and allowed namespace remapping rules;
- route provenance and target route verification;
- ICMP id/sequence state;
- packet buffer semantics, checksums/offload assumptions, and in-flight packet
  policy;
- timing/retry semantics that do not depend on hidden source-side state;
- target verifier gates for raw socket provenance and packet behavior;
- stable refusal codes for every unsupported neighboring state.

## Tasks

- [x] Keep `raw-icmp-ping-refusal` stable while the contract is absent.
- [x] Defer `raw-icmp-v1` design until after TCP listener/readiness proofs are stable; refusal remains the completed boundary.
- [x] Confirm no raw ICMP capture/planning support is added while the accepted subset remains intentionally absent.
- [x] Confirm no target-native raw socket recreation recipe is added while raw ICMP remains refused.
- [x] Confirm no target verifier claims ICMP id/sequence, route, or packet semantics while raw ICMP remains refused.
- [x] Keep positive proof profiles absent until the full contract and verifier exist; `raw-icmp-ping-refusal` remains authoritative.
- [x] Keep raw ICMP covered by the explicit `raw-icmp-ping-refusal` negative boundary until `raw-icmp-v1` exists; future support must add the nearby negatives listed above.
- [x] Update docs/support matrices with either the continued refusal boundary or
      the exact accepted raw ICMP subset.

## Proof requirements

Done only when either:

1. `ping` remains an explicit refusal with stable code and matrix coverage; or
2. a real arm64 `ping`/raw ICMP workload restores on amd64 with target-native
   completion under the full `raw-icmp-v1` contract.

If option 2 is chosen, all usual Goal 11 gates apply: no source-ISA emulation,
no runtime sidecar success, no app hooks, no source text replay, complete
provenance, and fail-closed neighboring negatives.

## Required validation

Record timings for every command/proof:

- schema validation for proof profiles;
- focused raw-socket/capability/namespace tests if positive support is added;
- remote arm64->amd64 proof if positive support is added;
- refusal matrix;
- foundation matrix;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run typecheck`;
- `pnpm run build:docs` if public docs/API changed;
- `pnpm exec fallow audit --changed-since origin/main`;
- full smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior changed.

## Completed boundary

Raw ICMP remains refused by `raw-icmp-ping-refusal` with code
`target-socket-syscall-state-unsupported`. No positive `ping` support was added;
future support still requires the full `raw-icmp-v1` contract above.

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
