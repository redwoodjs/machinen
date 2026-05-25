# Goal 20: Graduate master-audit refusal families

Parent context: [`goal-018.md`](./goal-018.md) completed the master audit by
adding stable refusal profiles for the remaining broad snapshot/restore gaps.
Those profiles are intentionally refused until each family has a precise portable
descriptor, source capture model, target-native restore recipe, target verifier
gates, positive proof, and negative neighboring-state matrix.

## Objective

Turn Goal 18's master-audit refusals into real supported subsets, one safe family
at a time. This goal must not remove refusals by relaxing gates. A refusal is
fixed only when a narrow accepted subset is graduated with target-native proof
and all neighboring unsupported states remain fail-closed.

## Candidate refusal families to fix

Goal 18 added these broad refusal profiles:

- `socket-receive-queue-general-refusal`
- `socket-send-queue-general-refusal`
- `udp-datagram-queue-refusal`
- `tcp-established-without-broker-refusal`
- `kqueue-readiness-refusal`
- `file-lock-refusal`
- `file-lease-refusal`
- `mmap-dirty-alias-refusal`
- `huge-page-special-mapping-refusal`
- `simd-fpu-state-refusal`
- `architecture-register-state-refusal`
- `dynamic-linker-state-refusal`
- `deleted-executable-mapping-refusal`
- `aslr-sensitive-pointer-refusal`
- `signal-handler-pc-stack-refusal`
- `thread-join-state-refusal`
- `thread-tls-edge-refusal`
- `timer-delivery-order-refusal`
- `pipe-buffered-data-waiter-refusal`
- `eventfd-waiter-alias-refusal`
- `namespace-routing-provenance-refusal`
- `target-next-packet-unverified-refusal`
- `stack-heap-edge-layout-refusal`
- `vvar-time-source-refusal`

## First recommended graduation targets

Pick a small, high-leverage subset first:

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
   - likely accepted subset: eventfd aliases over one open-file description with
     known counter and no waiters.

Do not attempt all families at once unless each has full proof coverage.

## Required graduation standard

For every refusal family fixed in this goal:

- [x] define an accepted subset name and descriptor version;
- [x] add source capture metadata for the exact kernel-visible state;
- [x] add descriptor/schema fields;
- [x] add target-native restore recipe;
- [x] add target verifier gates that prove the restored state, not merely a
      similar state;
- [x] add a positive proof profile;
- [x] add target-native negative profiles for neighboring unsupported states;
- [x] keep all still-unsupported cases refused with stable codes and
      `migrationCompleted=false`;
- [x] update support-envelope docs and proof matrices;
- [x] record descriptor sha256, continuation sha256 when applicable, artifacts,
      and timings;
- [x] prove no source-ISA emulation, sidecar runtime success, app hooks, hidden
      helpers, or source text replay were used.

## Required negative coverage

For the selected family, cover at least:

- [x] aliasing ambiguity;
- [x] stale source state;
- [x] mismatched target verifier state;
- [x] unsupported flags/options;
- [x] unsupported waiters or scheduler-visible races;
- [x] cross-namespace/cross-process ambiguity when applicable;
- [x] malformed descriptor/refusal path;
- [x] hidden helper/source dependency.

## Completion record

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

Current proof inventory after this graduation:

- 224 profiles total;
- 40 expected success profiles;
- 184 expected refusal profiles;
- support status counts: 11 baseline success, 29 graduated support, 181
  intentional refusal, 3 permanent refusal.

## Validation requirements

Run and record timings for:

- [x] proof profile schema validation — `NPM_CONFIG_USERCONFIG=/dev/null node scripts/portable-machine-proof-runner.mjs --validate-schema --json`: 0.046s;
- [x] focused unit tests for the selected family — `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/native-resource-translation.test.ts packages/runtime/src/__tests__/target-guest-restore-loader.test.ts packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts`: 3.382s;
- [x] positive target-native proof — `eventfd-alias-counter-recreate`: 37.168s;
- [x] negative target-native proofs — eight profiles listed above, 35.854s–36.604s each;
- [x] refusal matrix with checked summaries — `pnpm --silent portable-machine-proof-matrix -- --preset refusal --check-summary-dir /tmp/refusal-summaries-20-current --artifact-inventory /tmp/refusal20-current-artifacts.json --json --continue-on-fail`: 5.102s, 184/184 refusal profiles passed;
- [x] foundation matrix with checked summaries — `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-20-current --artifact-inventory /tmp/foundation20-current-artifacts.json --json --continue-on-fail`: 6.123s, 224 profiles passed;
- [x] `pnpm run format:check` — 0.756s;
- [x] `pnpm run lint` — 0.210s;
- [x] `pnpm run build:docs` — 1.692s;
- [x] `pnpm run typecheck` — 2.361s during full validation pass;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.097s;
- [x] `pnpm exec fallow audit --changed-since origin/main` — 0.406s;
- [x] `git diff --check` — 0.041s;
- [x] full smoke tests because restore/trampoline behavior changed —
      `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`: 135.557s.

## Completion criteria

Goal 20 is complete when at least one Goal 18 master-audit refusal family is
safely graduated into a narrow supported subset with full proof coverage, and all
other master-audit families either remain explicitly refused or are also
separately graduated with the same standard.
