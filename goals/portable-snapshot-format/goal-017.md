# Goal 17: Distro ping packet-state descriptor and v3 continuation

Parent context: [`goal-016.md`](./goal-016.md) kept the next distro ping
packet/timer states fail-closed because the runtime cannot yet prove exact packet
queue contents, exact in-flight echo identity, or multi-interval timer/sequence
continuity. Goal 15's only supported distro ping subset remains
`ping-socket-v2:loopback-echo-active-recvmsg-empty-queue`.

## Objective

Graduate one narrow `ping-socket-v3` distro ping packet-state continuation with
an exact descriptor model, target-native verifier gates, timer/signal ordering
rules, and a real arm64-to-amd64 proof. All neighboring packet, timer, queue,
control-message, and helper states must stay fail-closed unless they are covered
by the selected v3 contract.

## Outcome

No `ping-socket-v3` packet-state subset was graduated. The required descriptor
and verifier gates are still missing for exact packet bytes, ancillary data, and
`ppoll`/`setitimer` ordering, so Goal 17 completes via the explicit fail-closed
completion path: every candidate v3 subset remains refused with stable
`target-socket-syscall-state-unsupported`, `descriptorGateCompleted=true`, and
`migrationCompleted=false`.

Goal 17 adds three new target-native refusal profiles that name the exact missing
v3 gates:

- `ping-socket-active-recvmsg-packet-bytes-unknown-refusal`;
- `ping-socket-active-recvmsg-ancillary-data-unknown-refusal`;
- `ping-socket-active-recvmsg-ppoll-transition-refusal`.

The existing positive distro ping profile was re-run and still passes:

- `real-distro-ping-socket-loopback-recreate`;
- accepted subset: `ping-socket-v2:loopback-echo-active-recvmsg-empty-queue`;
- real Ubuntu `/usr/bin/ping` on arm64;
- target-native amd64 VM restore;
- `migrationCompleted=true` only after descriptor/resource/verifier gates pass.

## Candidate v3 subsets

Candidate names considered:

- `ping-socket-v3:loopback-echo-active-recvmsg-known-unread-reply` — remains
  refused because the source capture does not expose exact queued packet bytes or
  timestamp/TTL ancillary data needed to make the target's next `recvmsg` result
  byte-for-byte/semantically exact.
- `ping-socket-v3:loopback-echo-active-recvmsg-known-inflight` — remains refused
  because the source capture does not expose a verifier-safe in-flight packet
  identity that binds ICMP id, sequence, send timestamp, timeout behavior, and
  target-side next-packet observation.
- `ping-socket-v3:loopback-echo-multi-interval-sequence-continuity` — remains
  refused because it crosses `ppoll` / `sendto` / `recvmsg` /
  `setitimer(ITIMER_REAL)` ordering and needs a timer/signal transition model
  not present in Goal 15/16.

## Descriptor model audit

The selected safe subset is: none.

Required v3 descriptor fields and current status:

- [x] ICMP identifier — represented for existing ping-socket resources, but not
      enough to prove queued/in-flight packet replay.
- [x] ICMP sequence number — represented for existing ping-socket resources, but
      not enough to prove multi-interval sequence continuity.
- [x] source/destination identity — existing proofs remain loopback-only; any
      non-loopback destination remains refused.
- [x] exact queued packet bytes — missing for real distro ping kernel receive
      queues; now covered by
      `ping-socket-active-recvmsg-packet-bytes-unknown-refusal`.
- [x] ancillary data expectations — missing for timestamp/TTL/control-message
      proof; now covered by
      `ping-socket-active-recvmsg-ancillary-data-unknown-refusal`.
- [x] in-flight vs unread state classification — Goal 16 names known-inflight
      and known-unread candidates but keeps both refused until packet gates
      exist.
- [x] ambiguous/multiple/partial/stale/mismatched/non-loopback packet state —
      covered by existing and new target-native refusal profiles.

## Target verifier gate audit

The selected safe subset is: none.

Current verifier status:

- [x] recreated target socket identity for the v2 empty-queue subset is still
      proven by the positive profile.
- [x] queue/in-flight state for v2 is verified only as empty/no-in-flight.
- [x] known queued packet or known in-flight packet states are refused until a
      target verifier can prove the descriptor packet and next observed packet
      behavior exactly.
- [x] hidden helper/source-network dependency remains refused by existing
      negative profiles.
- [x] target verifier failures/refusals retain stable refusal behavior:
      `target-socket-syscall-state-unsupported`,
      `descriptorGateCompleted=true`, and `migrationCompleted=false`.

## Timer/signal model audit

The selected safe subset is: none.

Current timer/signal status:

- [x] Goal 15's active `recvmsg` empty-queue subset remains limited to
      `signalTimer=no-pending-signal-frame-target-wait-preserved`.
- [x] `setitimer(ITIMER_REAL)` interval ordering is not modeled for v3.
- [x] pending signal, active signal frame, and ambiguous restart states remain
      refused.
- [x] `ppoll` / `recvmsg` transition state remains refused until timeout memory,
      readiness, signal mask, and timer-order gates exist.
- [x] multi-interval sequence continuity remains refused until a verifier binds
      ICMP sequence, timer delivery, and next syscall transition.

## Positive proof status

No new positive v3 proof was claimed. The required positive proof was evaluated
and rejected as unsafe for now. The existing v2 proof was re-run to prove Goal 17
preserved Goal 15:

- [x] source is real Ubuntu `/usr/bin/ping`.
- [x] source runs as non-root uid/gid `1000` with ping socket authorization via
      `net.ipv4.ping_group_range`.
- [x] source opens `AF_INET` / `SOCK_DGRAM` / `IPPROTO_ICMP`.
- [x] source sends loopback ICMP echo traffic to `127.0.0.1`.
- [x] source capture lands in the supported v2 empty active-`recvmsg` state.
- [x] target is an amd64 VM running target-native continuation code.
- [x] `descriptorGateCompleted=true` before success.
- [x] all target verifier/resource gates pass.
- [x] `migrationCompleted=true` only after verifier gates pass.
- [x] proof summary records target resources and forbidden execution mechanism
      gates.

Positive proof facts:

- profile: `real-distro-ping-socket-loopback-recreate`;
- proof summary: `/tmp/goal17-real-distro-ping-socket-loopback-recreate.json`;
- local workdir:
  `/var/folders/jj/brzmsc2562zbwgzwbnjdnqp80000gn/T/machinen-real-distro-ping-socket-loopback-recreate-proof-c87d9dbba0d438`;
- result: `state=completed`, `pass=true`;
- target restore: `state=completed`, `migrationCompleted=true`,
  `descriptorGateCompleted=true`, `targetVerifierResult=passed`,
  `targetActiveSyscallRestoreResult=passed`.

## Refusal proof status

Goal 17 adds or preserves target-native negative coverage for all neighboring v3
states:

- [x] multiple in-flight echo requests:
      `ping-socket-active-recvmsg-multiple-inflight-refusal`.
- [x] multiple unread replies:
      `ping-socket-active-recvmsg-multiple-unread-replies-refusal`.
- [x] ICMP id mismatch:
      `ping-socket-active-recvmsg-id-sequence-mismatch-refusal`.
- [x] ICMP sequence mismatch:
      `ping-socket-active-recvmsg-id-sequence-mismatch-refusal`.
- [x] non-loopback destination:
      `ping-socket-active-recvmsg-nonloopback-refusal`.
- [x] ICMPv6: `ping-socket-active-recvmsg-icmpv6-refusal`.
- [x] unsupported control-message / ancillary-data expectations:
      `ping-socket-active-recvmsg-flags-control-refusal` and
      `ping-socket-active-recvmsg-ancillary-data-unknown-refusal`.
- [x] unsupported `recvmsg` flags:
      `ping-socket-active-recvmsg-flags-control-refusal`.
- [x] unsupported socket options or BPF/filter state:
      `ping-socket-active-recvmsg-unsupported-option-refusal`.
- [x] ambiguous `setitimer` / signal ordering:
      `ping-socket-active-recvmsg-signal-timer-refusal` and
      `ping-socket-active-recvmsg-ppoll-transition-refusal`.
- [x] unsupported `ppoll` / `recvmsg` transition state:
      `ping-socket-active-recvmsg-ppoll-transition-refusal`.
- [x] hidden helper process or source-side network dependency:
      `ping-socket-active-recvmsg-hidden-sidecar-refusal`.

New Goal 17 refusal proofs:

| Profile                                                     |    Time | Result                                                                                   |
| ----------------------------------------------------------- | ------: | ---------------------------------------------------------------------------------------- |
| `ping-socket-active-recvmsg-packet-bytes-unknown-refusal`   | 36.656s | passed; `target-socket-syscall-state-unsupported`, descriptor gate true, migration false |
| `ping-socket-active-recvmsg-ancillary-data-unknown-refusal` | 36.375s | passed; `target-socket-syscall-state-unsupported`, descriptor gate true, migration false |
| `ping-socket-active-recvmsg-ppoll-transition-refusal`       | 36.501s | passed; `target-socket-syscall-state-unsupported`, descriptor gate true, migration false |

Proof summaries:

- `/tmp/goal17-ping-socket-active-recvmsg-packet-bytes-unknown-refusal.json`;
- `/tmp/goal17-ping-socket-active-recvmsg-ancillary-data-unknown-refusal.json`;
- `/tmp/goal17-ping-socket-active-recvmsg-ppoll-transition-refusal.json`.

## Validation-performance result

Batching target-native negative profiles into one VM boot was evaluated but not
implemented in this goal. The proof runner and matrix contracts still treat each
profile as an independent smoke run with a separate workdir, summary, target
restore artifact, and gate check. Combining them would require a new batched
summary schema and matrix accounting.

Measured follow-up:

- new Goal 17 negative proofs each took about 36.4s;
- existing Goal 16 negative proofs spent about 17.1s in target boot/restore per
  profile;
- batching the 18 active-`recvmsg` refusal profiles into one VM boot could save
  roughly `(18 - 1) * 17.1s = 290s` of target boot/restore time before accounting
  for batching overhead;
- a practical follow-up is a batched target-native refusal harness that emits one
  parent summary plus per-profile child gate results.

## Implementation changes

- [x] Added three v3 descriptor/timer gate refusal profiles to
      `scripts/portable-machine-proof-profiles.json`.
- [x] Added those profiles to the distro ping unsafe variant list.
- [x] Updated proof profile count tests.
- [x] Updated support-envelope docs and final profile inventory.
- [x] Kept active syscall policy and target restore behavior unchanged for v3;
      no success subset was added because the required exact packet/timer gates
      are not available.
- [x] Recorded proof artifacts and validation timings in this file.

## Validation timings

| Category           | Command/proof                                                                                                                                                                                  |    Time | Result                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------: | --------------------------------------------- |
| Matrix/schema      | `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`                                                                                                                      |  0.156s | passed                                        |
| Local focused      | `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts packages/runtime/src/__tests__/portable-machine-proof-matrix.test.ts`     |  3.454s | passed                                        |
| Remote proof       | `real-distro-ping-socket-loopback-recreate`                                                                                                                                                    | 51.940s | passed                                        |
| Remote negative    | `ping-socket-active-recvmsg-packet-bytes-unknown-refusal`                                                                                                                                      | 36.656s | passed                                        |
| Remote negative    | `ping-socket-active-recvmsg-ancillary-data-unknown-refusal`                                                                                                                                    | 36.375s | passed                                        |
| Remote negative    | `ping-socket-active-recvmsg-ppoll-transition-refusal`                                                                                                                                          | 36.501s | passed                                        |
| Matrix/schema      | refusal matrix with checked summaries: `pnpm --silent portable-machine-proof-matrix -- --preset refusal --check-summary-dir /tmp/refusal-summaries-17 --json --continue-on-fail`               |  3.527s | passed; 152 refusal profiles                  |
| Matrix/schema      | foundation matrix with checked summaries: `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-17 --json --continue-on-fail` |  4.515s | passed; 191 profiles, 39 success, 152 refusal |
| Local static       | `pnpm run format:check`                                                                                                                                                                        |  0.604s | passed                                        |
| Local static       | `pnpm run lint`                                                                                                                                                                                |  0.200s | passed                                        |
| Docs/API           | `pnpm run build:docs`                                                                                                                                                                          |  1.649s | passed                                        |
| Local static       | `pnpm run typecheck`                                                                                                                                                                           |  2.226s | passed                                        |
| Local unit tests   | `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`                                                                                                                                               | 26.869s | passed                                        |
| Architecture audit | `pnpm exec fallow audit --changed-since origin/main`                                                                                                                                           |  0.390s | passed                                        |
| Whitespace         | `git diff --check`                                                                                                                                                                             |  0.014s | passed                                        |

Full smoke tests were not run for the current Goal 17 delta because the change
adds proof-profile refusal coverage and docs only; VM/VMM, rootfs/base assets,
CLI boot/exec/mount, snapshot/restore runtime behavior, virtio devices,
memory/ballooning, and FUSE/live mounts were not changed after the already-run
remote target-native proofs.

## Final inventory

- 191 profiles total;
- 39 expected success profiles;
- 152 expected refusal profiles;
- support status counts: 11 baseline success, 28 graduated support, 149
  intentional refusal, 3 permanent refusal.

## Completion criteria audit

Goal 17 completes via criterion 2:

- [x] all candidate v3 subsets were evaluated and remain unsafe for now;
- [x] every candidate remains fail-closed with target-native refusal evidence;
- [x] the exact missing gates are recorded: queued packet bytes,
      timestamp/TTL ancillary data, in-flight packet identity, next-packet
      verifier behavior, and `ppoll`/`setitimer` signal ordering;
- [x] Goal 15/16 positive support was preserved and re-proven;
- [x] validation timings, final inventory, and performance follow-up are
      recorded.
