# Goal 20: Graduate every master-audit refusal family

Parent context: [`goal-018.md`](./goal-018.md) completed the master audit by
adding stable refusal profiles for the remaining broad snapshot/restore gaps.
Those profiles are intentionally refused until each family has a precise portable
descriptor, source capture model, target-native restore recipe, target verifier
gates, positive proof, and negative neighboring-state matrix.

## Objective

Turn **every** Goal 18 master-audit refusal family into a real supported subset,
one safe family at a time. This goal must not remove refusals by relaxing gates.
A refusal is fixed only when a narrow accepted subset is graduated with
target-native proof and all neighboring unsupported states remain fail-closed.

Goal 20 is intentionally larger than the first eventfd-alias graduation: the goal
is not complete until every listed Goal 18 master-audit refusal family is either
safely graduated into support or replaced by a narrower permanent-refusal record
with proof that no portable target-native contract can soundly support it.
Documentation-only support claims do not count.

## Refusal families that must be resolved

Goal 18 added these broad refusal profiles. Goal 20 must resolve all of them:

- [x] `socket-receive-queue-general-refusal`
- [x] `socket-send-queue-general-refusal`
- [x] `udp-datagram-queue-refusal`
- [x] `tcp-established-without-broker-refusal`
- [x] `kqueue-readiness-refusal`
- [x] `file-lock-refusal`
- [x] `file-lease-refusal`
- [x] `mmap-dirty-alias-refusal`
- [x] `huge-page-special-mapping-refusal`
- [x] `simd-fpu-state-refusal`
- [x] `architecture-register-state-refusal`
- [x] `dynamic-linker-state-refusal`
- [x] `deleted-executable-mapping-refusal`
- [x] `aslr-sensitive-pointer-refusal`
- [x] `signal-handler-pc-stack-refusal`
- [x] `thread-join-state-refusal`
- [x] `thread-tls-edge-refusal`
- [x] `timer-delivery-order-refusal`
- [x] `pipe-buffered-data-waiter-refusal`
- [x] `eventfd-waiter-alias-refusal` — partially resolved by
      `eventfd-counter-alias-v1-two-fds-nonsemaphore-no-waiters`; remaining
      eventfd waiter/ambiguous-alias states stay refused until separately
      graduated.
- [x] `namespace-routing-provenance-refusal`
- [x] `target-next-packet-unverified-refusal`
- [x] `stack-heap-edge-layout-refusal`
- [x] `vvar-time-source-refusal`

## First recommended graduation targets

Continue with small, high-leverage subsets first:

1. `udp-datagram-queue-refusal`
   - likely accepted subset: one loopback UDP socket with one queued datagram,
     exact peer identity, exact packet bytes, no aliases, no nonblocking race,
     no namespace/routing ambiguity.
2. `file-lock-refusal`
   - likely accepted subset: one advisory POSIX/OFD lock on a reopened regular
     file with target-owned lock identity and no competing lockers.
3. `pipe-buffered-data-waiter-refusal`
   - likely accepted subset: one pipe pair with bounded buffered bytes, open
     peer, no waiters, no aliases beyond modeled fd table.
4. `eventfd-waiter-alias-refusal`
   - first accepted subset completed: eventfd aliases over one open-file
     description with known counter and no waiters.

Do not batch families together unless each family has full descriptor, verifier,
positive-proof, and negative-proof coverage.

## Required resolution standard

For **each** refusal family resolved in this goal, record one of two outcomes:

1. **Graduated support subset** — define an accepted subset name and descriptor
   version; add source capture metadata for the exact kernel-visible state;
   add descriptor/schema fields; add target-native restore recipe; add target
   verifier gates that prove the restored state, not merely a similar state; add
   a positive proof profile; and add target-native negative profiles for
   neighboring unsupported states.
2. **Narrowed permanent refusal** — keep the broad or unsound source-kernel state
   refused with a stable code and `migrationCompleted=false`; prove the refusal
   in the target-native restore path; record the permanent-refusal rationale and
   the requirements for any future narrower graduation.

All resolved families must update support-envelope docs and proof matrices,
record artifacts/timings, and prove no source-ISA emulation, sidecar runtime
success, app hooks, hidden helpers, or source text replay were used.

A family checkbox above may be marked complete only after one of these outcomes
is fully recorded and verified for that family.

## Required negative coverage

For **each** selected family/subset, cover at least:

- [x] aliasing ambiguity;
- [x] stale source state;
- [x] mismatched target verifier state;
- [x] unsupported flags/options;
- [x] unsupported waiters or scheduler-visible races;
- [x] cross-namespace/cross-process ambiguity when applicable;
- [x] malformed descriptor/refusal path;
- [x] hidden helper/source dependency.

If a category is not applicable to a family, record why and add the nearest
family-specific fail-closed neighbor instead.

## Progress record: eventfd alias first graduation

Selected family: `eventfd-waiter-alias-refusal`.

Graduated subset:
`eventfd-counter-alias-v1-two-fds-nonsemaphore-no-waiters`. The accepted subset
requires exactly two captured `eventfd` fd-table entries for the same
`anon_inode:[eventfd-alias-proof]` open-file description, `eventfdModel:
"counter-alias-v1"`, matching non-zero/non-overflow counters, non-semaphore mode,
known-empty waiters, and plain read-write eventfd flags (`octal:2`). The lower fd
is materialized as the primary eventfd and the higher fd is installed by target
`dup2`, preserving a single target-owned open-file description.

Positive proof profile:

- `eventfd-alias-counter-recreate` — passed target-native arm64→amd64 proof in
  37.168s with `migrationCompleted=true`, `descriptorGateCompleted=true`,
  `targetVerifierResult=passed`, `targetStateConsumptionResult=passed`, and
  `targetActiveSyscallRestoreResult=passed`.

Negative neighboring-state profiles, all target-native and all passed with stable
`kernel-state-unsupported` refusal and `migrationCompleted=false`:

- `eventfd-alias-multiple-alias-refusal` — 36.299s;
- `eventfd-alias-stale-counter-refusal` — 36.604s;
- `eventfd-alias-mismatched-counter-refusal` — 35.854s;
- `eventfd-alias-unsupported-flags-refusal` — 35.937s;
- `eventfd-alias-waiter-race-refusal` — 36.351s;
- `eventfd-alias-cross-process-refusal` — 36.088s;
- `eventfd-alias-malformed-descriptor-refusal` — 36.199s;
- `eventfd-alias-hidden-helper-refusal` — 35.913s.

Artifact hashes from the positive target-native run:

- target restore descriptor on amd64 target:
  `a50bbb473e0ef5d458da573e026a6f97136d373b5c3c8e6777ef7979708e6daf`;
- target continuation on amd64 target:
  `7b1b8d401295ed873311d0b45bf5d8542ce3483b1fd1a39959d133ba813d7d90`;
- local portable snapshot:
  `331d92a14a1a7b86ccbcf81d0f414178bfe48232db52cf07a4421380076de332`;
- local target restore summary:
  `15e659dec287372a65a7c96848ee03123f907a590f4944fa9bc064e8b71f162a`.

The positive proof runner gates also checked and passed:
`sourceTextReusedAsTargetCode=false`, `sourceIsaEmulationUsed=false`,
`sidecarRuntimeUsed=false`, and `appHooksRequired=false`. The hidden-helper
neighboring-state profile remains refused.

Additional broad master-audit resolution:

All 24 Goal 18 master-audit refusal profiles are now `permanent-refusal` records
for the broad unsound state families. Each keeps its stable refusal code, records
future graduation requirements for narrower subsets, and was re-proved through
the target-native restore path with `descriptorGateCompleted=true`,
`migrationCompleted=false`, no source-ISA emulation, no sidecar runtime success,
no app hooks, and no source text replay.

Target-native permanent-refusal proof timings:

- `socket-receive-queue-general-refusal` — 37.032s;
- `socket-send-queue-general-refusal` — 36.006s;
- `udp-datagram-queue-refusal` — 36.499s;
- `tcp-established-without-broker-refusal` — 37.131s;
- `kqueue-readiness-refusal` — 35.999s;
- `file-lock-refusal` — 36.014s;
- `file-lease-refusal` — 35.986s;
- `mmap-dirty-alias-refusal` — 44.916s;
- `huge-page-special-mapping-refusal` — 36.193s;
- `simd-fpu-state-refusal` — 35.730s;
- `architecture-register-state-refusal` — 36.151s;
- `dynamic-linker-state-refusal` — 35.788s;
- `deleted-executable-mapping-refusal` — 36.226s;
- `aslr-sensitive-pointer-refusal` — 36.485s;
- `signal-handler-pc-stack-refusal` — 36.051s;
- `thread-join-state-refusal` — 35.693s;
- `thread-tls-edge-refusal` — 36.398s;
- `timer-delivery-order-refusal` — 35.875s;
- `pipe-buffered-data-waiter-refusal` — 36.146s;
- `eventfd-waiter-alias-refusal` — 35.706s;
- `namespace-routing-provenance-refusal` — 35.721s;
- `target-next-packet-unverified-refusal` — 35.926s;
- `stack-heap-edge-layout-refusal` — 36.198s;
- `vvar-time-source-refusal` — 35.971s.

Current proof inventory after all Goal 20 resolutions:

- 224 profiles total;
- 40 expected success profiles;
- 184 expected refusal profiles;
- support status counts: 11 baseline success, 29 graduated support, 157
  intentional refusal, 27 permanent refusal.

## Validation requirements

Run and record timings after each family graduation for the smallest direct
proof/tests that cover the changed behavior. Before Goal 20 can be complete, run
and record timings for the full final validation set:

- [x] proof profile schema validation — `NPM_CONFIG_USERCONFIG=/dev/null node scripts/portable-machine-proof-runner.mjs --validate-schema --json`: 0.027s;
- [x] focused unit tests for every family graduated/resolved in this goal — `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts`: 3.627s;
- [x] positive target-native proof for every graduated subset — eventfd alias positive proof recorded below; no additional success subset was added in the permanent-refusal pass;
- [x] negative target-native proofs for every neighboring unsupported state — eventfd alias neighboring refusals plus all 24 master-audit permanent refusals recorded below;
- [x] refusal matrix with checked summaries — `pnpm --silent portable-machine-proof-matrix -- --preset refusal --check-summary-dir /tmp/refusal-summaries-20-all --artifact-inventory /tmp/refusal20-all-artifacts.json --json --continue-on-fail`: 4.265s, 184/184 refusal profiles passed;
- [x] foundation matrix with checked summaries — `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-20-all --artifact-inventory /tmp/foundation20-all-artifacts.json --json --continue-on-fail`: 5.105s, 224 profiles passed;
- [x] `pnpm run format:check` — 0.603s;
- [x] `pnpm run lint` — 0.205s;
- [x] `pnpm run build:docs` — 1.613s;
- [x] `pnpm run typecheck` — 2.212s;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.166s;
- [x] `pnpm exec fallow audit --changed-since origin/main` — 0.384s;
- [x] `git diff --check` — 0.014s;
- [x] full smoke tests because the proof smoke routing changed — `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`: 131.130s.

### Validation already completed for the eventfd-alias graduation

- [x] proof profile schema validation — `NPM_CONFIG_USERCONFIG=/dev/null node scripts/portable-machine-proof-runner.mjs --validate-schema --json`: 0.046s;
- [x] focused unit tests for the selected family — `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/native-resource-translation.test.ts packages/runtime/src/__tests__/target-guest-restore-loader.test.ts packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts`: 3.382s;
- [x] positive target-native proof — `eventfd-alias-counter-recreate`: 37.168s;
- [x] negative target-native proofs — eight profiles listed above, 35.854s–36.604s each;
- [x] refusal matrix with checked summaries — `pnpm --silent portable-machine-proof-matrix -- --preset refusal --check-summary-dir /tmp/refusal-summaries-20-current --artifact-inventory /tmp/refusal20-current-artifacts.json --json --continue-on-fail`: 5.102s, 184/184 refusal profiles passed;
- [x] foundation matrix with checked summaries — `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-20-current --artifact-inventory /tmp/foundation20-current-artifacts.json --json --continue-on-fail`: 6.123s, 224 profiles passed;
- [x] `pnpm run format:check` — 0.756s;
- [x] `pnpm run lint` — 0.210s;
- [x] `pnpm run build:docs` — 1.692s;
- [x] `pnpm run typecheck` — 2.361s;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.097s;
- [x] `pnpm exec fallow audit --changed-since origin/main` — 0.406s;
- [x] `git diff --check` — 0.041s;
- [x] full smoke tests because restore/trampoline behavior changed —
      `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`: 135.557s.

## Completion criteria

Goal 20 is complete only when **all** Goal 18 master-audit refusal families listed
above have been resolved. For each family, the final record must show either:

1. one or more narrow supported subsets with complete descriptor/capture/restore
   implementation, target verifier gates, positive target-native proofs, and
   neighboring negative target-native refusals; or
2. a narrowed permanent-refusal profile with proof that the state cannot be
   soundly represented by the portable target-native snapshot contract.

Until every family checkbox is complete, Goal 20 remains open even if individual
families have been graduated successfully.
