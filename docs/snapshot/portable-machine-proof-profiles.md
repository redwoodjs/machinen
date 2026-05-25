# Portable machine proof profiles

The native cross-ISA VM proof has a checked-in profile matrix in
[`scripts/portable-machine-proof-profiles.json`](../../scripts/portable-machine-proof-profiles.json).
Each row names the remote source target, source fixture, optional traced syscall
and fd, expected result, app-neutral `capabilities` or `refusesCapabilities`, and
target gates that must pass before automation may report success. The fail-closed
refusal-code inventory lives in
[`native-fail-closed-refusal-inventory.md`](./native-fail-closed-refusal-inventory.md).

Validate profile schema and capability coverage with:

```sh
pnpm --silent portable-machine-proof-runner -- --validate-schema --json
```

Run one profile with:

```sh
pnpm --silent portable-machine-proof-runner -- --profile file-readv --json
```

Run matrices with the presets documented in
[`proof-matrices.md`](./proof-matrices.md).

For test or CI wiring that should not contact remotes or boot the target VM:

```sh
pnpm --silent portable-machine-proof-runner -- --profile file-readv --dry-run --json
```

Dry runs exercise profile selection, synthetic capture/bundle creation, and JSON
summary writing, but they intentionally report `pass: false` and `state:
"skipped"`. A run is successful only when the underlying smoke profile completes
and the gate checker passes.

## Gate checker

The runner refuses success unless the smoke summary and target restore result
show all required gates for the selected profile. The common success checks are:

- smoke summary `state="completed"`;
- matching `remoteSourceTarget`;
- target restore `state="completed"`;
- `migrationCompleted=true`;
- `descriptorGateCompleted=true`.

Profiles then add explicit target gates from the matrix, including verifier,
state consumption, fd/resource status, return-chain, frame, registers/RFLAGS,
TLS, stack-window, private-memory, executable mapping, signal restore,
active-syscall restore, process-context restore, controlled thread restore, and
resume-path checks.

Every profile also carries a support status:

- `baseline-success`: part of the original constrained success class.
- `intentional-refusal`: fail-closed today, but may graduate after an exact
  model lands.
- `permanent-refusal`: an invariant of the native-transparent contract, not a
  backlog support item.
- `graduated-support`: a formerly refused family now has a positive target-native
  subset. These profiles must record `graduatedFromRefusalCode`, an
  `acceptedSubset`, and unsafe variants that still refuse. Goal 8/9 and Goal 21
  declarative profiles use `synthetic-positive:*` fixtures to exercise the same
  target gates and provenance contract without accepting source-ISA emulation,
  runtime sidecars, app hooks, or source text replay.

Negative profiles set `expectedResult: "refusal"`. They are pass/fail checks for
unsafe states, not accepted migrations. The runner treats a negative profile as
passing only when the checked summary matches the unsafe-state family, carries
exactly the expected refusal code, keeps `migrationCompleted=false`, keeps
`descriptorGateCompleted=false` unless the profile explicitly says otherwise,
and does not claim source text reuse, source-ISA emulation, or a sidecar runtime
as success. A negative profile fails if the summary or target restore reaches
`completed` target-native success.

Existing summaries can be checked without running the proof:

```sh
pnpm --silent portable-machine-proof-runner -- \
  --profile file-writev \
  --check-summary /tmp/machinen-file-writev-e2e/summary.json \
  --json
```

This exits non-zero if any required gate is missing or not `passed`.

## Goal 8/9/11/12/13/14/15/21 graduated capability set

The current graduated set also includes the Goal 8/9 app-neutral blockers,
Goal 11 real workload proofs, Goal 12 raw ICMP loopback proof, Goal 13 ping-socket loopback proof, Goal 14 non-root ping-socket proof, and Goal 15 distro ping active recvmsg proof in
[`goal-8-9-capability-graduations.md`](./goal-8-9-capability-graduations.md):
`tcp-listener-recreate`, `real-tcp-listener-recreate`,
`real-tcp-listener-readiness-recreate`,
`real-tcp-active-connection-transport-recreate`,
`real-raw-icmp-loopback-recreate`, `real-ping-socket-loopback-recreate`,
`real-nonroot-ping-socket-loopback-recreate`,
`real-distro-ping-socket-loopback-recreate`, `private-multi-range-recreate`,
`epoll-graph-recreate`, `file-backed-private-mapping-recreate`,
`active-syscall-eintr-recreate`,
`tcp-active-connection-transport-recreate`,
`tcp-listener-readiness-recreate`, `futex-private-wait-wake-recreate`,
`rseq-absent-or-target-registered-recreate`, and
`shared-memory-contract-recreate`. Goal 21 adds 49 `goal21:*` target-native
subset profiles for the next refusal-to-support targets; each has its own
accepted subset, artifact hashes, verifier gates, and at least five nearby
refusal profiles in `unsafeVariants`. Goal 22 upgrades those Goal 21 neighbor
refusals from profile-only synthetic shortcuts to concrete descriptor fixtures in
`scripts/fixtures/goal21-negative-descriptor-fixtures.json`; each concrete
negative profile now uses a `concrete-negative:goal21/...` source fixture and
records the descriptor hash that drives the target restore refusal. Each positive
profile has nearby refusal profiles in `unsafeVariants`.

## Refusal graduation checklist

A refused family may move to `graduated-support` only when the same PR documents
and tests all of the following:

1. **Portable state model** — exact descriptor fields, provenance, and bounds.
2. **Target restore recipe** — target-native syscalls or loader actions used to
   recreate state.
3. **Target gates** — checks proving descriptor consumption, target-native
   completion, and resource-specific state.
4. **Positive profile** — a profile with `expectedResult: "success"`,
   `supportStatus: "graduated-support"`, `graduatedFromRefusalCode`, and an
   accepted subset name.
5. **Negative variants** — nearby unsafe states that still assert exact refusal
   codes and `migrationCompleted=false`.
6. **Docs and validation timings** — update the refusal inventory and the goal
   ledger before claiming completion.

The runner refuses a graduated success profile that reports
`migrationCompleted=true` without descriptor completion and the listed target
native gates.

## Constrained native-transparent class

The current supported class is deliberately narrow: an arm64 Linux process
captured by the native-process bundle can restore into an amd64 VM only when its
state is covered by one of the proof profiles below and every listed target gate
passes. The accepted class includes:

- target-native continuation bytes from the portable bundle target root;
- metadata-proven return-chain/frame/register/RFLAGS/TLS/stack-window restore;
- target-owned private-memory, executable-mapping, signal, resource, and
  descriptor consumption gates;
- regular-file fd recipes, stdio/close-fd recipes, the modeled synthetic empty
  pipe/eventfd/timerfd proof states, the Goal 4 `pipe-pair-v1` empty open-peer
  descriptor subset, the Goal 4 `eventfd-counter-v1` descriptor subset, the Goal
  4 `timerfd-descriptor-v1` disarmed/relative-one-shot descriptor subset, the
  Goal 3 epoll `interest-list-v1` reconstruction subset,
  the Goal 3 signalfd `empty-queue-v1` descriptor subset, the Goal 11 real
  loopback TCP listener/readiness plus explicit-broker active TCP subsets, and
  the Goal 12 raw ICMP loopback echo no-in-flight subset, the Goal 13 Linux
  ping-socket loopback echo no-in-flight subset, and the Goal 15 distro ping
  active `recvmsg` empty-queue wait subset;
- active syscall completion only for sleep/`ppoll` timeout, empty pipe read,
  empty eventfd read, timerfd read, offset-backed regular-file
  `read`/`pread64`/single-iovec `readv`, and offset-backed regular-file
  `write`/`pwrite64`/single-iovec `writev` cases;
- the controlled two-thread `ppoll` profile and the bounded process-context
  profile.

Everything outside that class must fail closed with a stable refusal before
`migrationCompleted=true`: raw ICMP outside `raw-icmp-v1` loopback echo, ping
sockets outside `ping-socket-v1`/`ping-socket-v2` loopback echo,
sockets without an explicit broker contract,
epoll/signalfd state outside their graduated subsets, futex/rseq/general scheduler
state beyond ordinary private-memory data copying, source vDSO/vvar copying,
source executable text reuse, JIT or
self-modifying code without a target-native regeneration descriptor, active
`recvmsg` packet-queue ambiguity outside the distro ping empty-queue contract,
pending
signals/active signal frames, raw cross-ISA
`.vmstate` replay, missing provenance, malformed descriptors, or unsupported
resource kinds. The proof is not a Node/Bun sidecar, source-ISA emulation, app
hook, or source-text replay path; success means target-native completion after
all profile gates pass.

## Current positive profiles

| Profile                           | Unsafe family             | Required refusal code                     | Descriptor gate |
| --------------------------------- | ------------------------- | ----------------------------------------- | --------------- |
| `readiness-wait-refusal`          | readiness-wait            | `kernel-state-unsupported`                | false           |
| `readiness-scheduler-refusal`     | readiness-scheduler       | `kernel-state-unsupported`                | false           |
| `readiness-edge-trigger-refusal`  | readiness-edge-trigger    | `kernel-state-unsupported`                | false           |
| `readiness-signal-mask-refusal`   | readiness-signal-mask     | `signal-state-unsupported`                | false           |
| `readiness-pollfd-memory-refusal` | readiness-pollfd-memory   | `mapping-provenance-ambiguous`            | false           |
| `socket-readiness-refusal`        | socket-readiness          | `target-socket-syscall-state-unsupported` | false           |
| `auxv-source-pointer-refusal`     | process-context-auxv      | `target-process-context-unsupported`      | false           |
| `at-random-source-refusal`        | process-context-at-random | `target-process-context-unsupported`      | false           |
| `at-execfn-identity-refusal`      | process-context-at-execfn | `target-process-context-unsupported`      | false           |
| `target-libc-global-refusal`      | target-libc-global        | `target-process-context-unsupported`      | false           |
| `argv-env-pointer-refusal`        | process-context-argv-env  | `target-process-context-unsupported`      | false           |
| `private-layout-refusal`          | private-memory-layout     | `mapping-permission-unsupported`          | false           |
| `shared-mapping-refusal`          | shared-mapping            | `mapping-shared-unsupported`              | false           |
| `private-source-pointer-refusal`  | private-source-pointer    | `mapping-provenance-ambiguous`            | false           |
| `stale-private-range-refusal`     | private-stale-range       | `mapping-captured-range-unsupported`      | false           |
| `wx-private-mapping-refusal`      | private-wx-mapping        | `mapping-executable-unsupported`          | false           |
| `signal-mask-restart-refusal`     | signal-restart            | `signal-state-unsupported`                | false           |
| `pending-signal-refusal`          | pending-signal            | `signal-state-unsupported`                | false           |
| `active-signal-frame-refusal`     | active-signal-frame       | `signal-state-unsupported`                | false           |
| `alt-stack-refusal`               | signal-alt-stack          | `signal-state-unsupported`                | false           |
| `restart-remaining-time-refusal`  | restart-remaining-time    | `syscall-restart-unsupported`             | false           |
| `socket-transfer-refusal`         | socket                    | `target-socket-syscall-state-unsupported` | false           |
| `epoll-wait-refusal`              | epoll                     | `target-epoll-syscall-state-unsupported`  | false           |
| `signalfd-read-refusal`           | signalfd                  | `target-signalfd-state-unsupported`       | false           |
| `futex-refusal`                   | futex                     | `futex-state-unsupported`                 | false           |
| `rseq-refusal`                    | rseq                      | `rseq-state-unsupported`                  | false           |
| `restart-state-refusal`           | restart                   | `syscall-restart-unsupported`             | false           |
| `jit-self-modifying-refusal`      | jit-self-modifying-code   | `mapping-executable-unsupported`          | false           |
| `source-vdso-vvar-refusal`        | source-vdso-vvar          | `vdso-policy-unsupported`                 | false           |
| `raw-cross-isa-vmstate-refusal`   | raw-cross-isa-vmstate     | `cross-isa-vmstate-restore-unsupported`   | false           |
| `descriptor-provenance-refusal`   | descriptor-provenance     | `mapping-provenance-ambiguous`            | false           |
| `duplicate-fd-alias-refusal`      | duplicate-fd-alias        | `target-fd-table-duplicate`               | false           |
| `fd-alias-lock-refusal`           | fd-alias-lock             | `target-fd-table-duplicate`               | false           |
| `fd-alias-socket-refusal`         | fd-alias-socket           | `target-socket-syscall-state-unsupported` | false           |
| `fd-alias-epoll-cycle-refusal`    | fd-alias-epoll-cycle      | `target-epoll-syscall-state-unsupported`  | false           |

All profiles also require descriptor, verifier, state-consumption, resource,
return-chain, frame, register/RFLAGS, TLS, stack-window, private-memory,
executable, signal, and resume-path gates. The matrix is the automation contract
for the current constrained class: adding a new accepted family requires a new
profile (or an explicit documented refusal if it stays unsupported), target gate
coverage, fail-closed tests, and docs updates before it can be counted as
native-transparent success.

Goal 6 adds five graduated support profiles on top of the refusal matrix:
`eventfd-readiness-pollin-recreate`, `regular-file-duplicate-fd-recreate`,
`target-auxv-at-random`, `private-anonymous-data-range-recreate`, and
`signal-mask-blocked-recreate`. Each starts from one proven Goal 5 refusal and
keeps the adjacent unsafe variants in the runnable refusal matrix.
