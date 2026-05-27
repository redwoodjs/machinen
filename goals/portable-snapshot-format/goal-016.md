# Goal 16: Distro ping multi-interval and packet-state contract

Parent context: [`goal-015.md`](./goal-015.md) graduated real non-root Ubuntu
`/usr/bin/ping` for the narrow
`ping-socket-v2:loopback-echo-active-recvmsg-empty-queue` subset. That proof
captures after the first loopback echo reply has been consumed and restores the
blocked active `recvmsg` wait as an empty target receive queue with no in-flight
ICMP ambiguity.

## Objective

Broaden and harden distro ping support beyond the single empty-queue active
`recvmsg` capture point, while keeping the support envelope target-native,
loopback-only unless explicitly graduated, and fail-closed for ambiguous packet,
timer, control-message, or helper state.

## Outcome

No new packet-state success subset was graduated. Goal 16 investigated the next
candidate states and kept them refused because the current portable contract
cannot yet prove exact source packet queue contents, exact in-flight echo
identity, or multi-interval timer/sequence continuity without broader packet and
timer verifier gates.

Goal 15 remains the only positive distro ping subset:

- `ping-socket-v2:loopback-echo-active-recvmsg-empty-queue`

Goal 16 adds target-native refusal coverage for the next packet/timer states and
adds a validation-speed improvement by caching the source distro ping proof image
on the arm64 remote.

## Candidate accepted subsets

Candidate names investigated:

- `ping-socket-v3:loopback-echo-active-recvmsg-known-inflight` — remains refused.
- `ping-socket-v3:loopback-echo-active-recvmsg-known-unread-reply` — remains
  refused.
- `ping-socket-v3:loopback-echo-multi-interval-sequence-continuity` — remains
  refused.

Reasons these were not graduated:

- a known in-flight echo needs a descriptor and target verifier that bind the
  source send timestamp, ICMP id/sequence, target-side resend/receive behavior,
  and timeout semantics into one exact next-packet contract;
- a known unread reply needs exact packet bytes plus ancillary data
  (`SO_TIMESTAMP`, `IP_TTL`) and queue-order proof, not just an inferred
  `recvmsg` buffer shape;
- multi-interval ping transitions through `ppoll`, `sendto`, `recvmsg`, and
  `setitimer`/signal behavior, so sequence continuity needs a timer/signal
  ordering model outside Goal 15's empty wait preservation.

## Non-goals

- Internet or routed-network ping support unless a later goal explicitly adds a
  route/namespace contract.
- DNS, broadcast, multicast, marks, policy routing, or source namespace replay.
- Arbitrary packet queue replay.
- Arbitrary `recvmsg` support for non-ping sockets.
- Claiming success by launching a fresh target ping process.
- Source-ISA emulation, runtime sidecar success, app hooks, source text replay,
  or hidden helper processes.
- General SIMD/FPU restoration.

## Investigation results

Investigation artifacts:

- remote host: `friend@100.126.46.90`;
- local copy: `/tmp/goal16-investigate`;
- remote copy: `/tmp/machinen-goal16-investigate`;
- source image: `machinen-distro-ping-proof:ubuntu-24.04`;
- image sha256: `sha256:a7a9b13e5c81b7e0a7f1d7bfb94affb6bee767fa91169f676b70ad5578324717`;
- image size: `103954495` bytes.

### First recvmsg / before first reply is safely classified

Native bundle:

- `/tmp/goal16-investigate/first-recvmsg/bundle`

Facts:

- source command: non-root `/usr/bin/ping -i 10 127.0.0.1`;
- native capture stopped at syscall entry for `recvmsg` fd `3`;
- thread: `thread:11`;
- active syscall: `recvmsg`, number `212`;
- args: fd `0x3`, msghdr pointer `0xfffff5721520`, flags `0x0`;
- signal: blocked `0`, pending `0`, activeFrame `false`, altStack `disabled`;
- fd `3`: socket `socket:[4556957]`, flags `octal:2`;
- fd `4`: IPv6 ping socket neighbor, outside the IPv4 subset.

Strace facts:

```text
socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP) = 3
socket(AF_INET6, SOCK_DGRAM, IPPROTO_ICMPV6) = 4
socket(AF_INET, SOCK_DGRAM, IPPROTO_IP) = 5
sendto(3, ..., 64, 0, {sa_family=AF_INET, sin_addr=inet_addr("127.0.0.1")}, 16) = 64
setitimer(ITIMER_REAL, {it_value={tv_sec=10, tv_usec=0}}, NULL) = 0
recvmsg(3, ..., 0) = 64
```

Decision: not graduated. The capture point proves a real first `recvmsg` entry,
but not whether the echo reply is already queued, merely in flight, or about to
arrive. Supporting it requires an exact known-in-flight/known-unread packet
contract.

### Multi-interval / sequence continuity

Native bundle:

- `/tmp/goal16-investigate/multi-interval/bundle`

Facts:

- source command: non-root `/usr/bin/ping -i 1 127.0.0.1`;
- strace shows three sends and replies for sequences `1`, `2`, and `3`;
- native capture at settle `2600ms` stopped in `ppoll`, not `recvmsg`;
- thread: `thread:17`;
- active syscall: `ppoll`, number `73`;
- args include one pollfd pointer and one timeout pointer;
- signal: blocked `0`, pending `0`, activeFrame `false`, altStack `disabled`;
- fd `3`: socket `socket:[4558985]`, flags `octal:2`.

Strace facts:

```text
sendto(3, ..., icmp_seq=1, ...) = 64
recvmsg(3, ..., 0) = 64
recvmsg(3, {msg_namelen=128}, 0) = -1 EAGAIN
sendto(3, ..., icmp_seq=2, ...) = 64
recvmsg(3, ..., 0) = 64
sendto(3, ..., icmp_seq=3, ...) = 64
setitimer(ITIMER_REAL, {it_value={tv_sec=1, tv_usec=0}}, NULL) = 0
recvmsg(3, ..., 0) = 64
```

Decision: not graduated. Multi-interval support is not just ping-socket
`recvmsg`; it needs a `ppoll`/timer/signal ordering and ICMP sequence continuity
contract.

### Timer window

Native bundle:

- `/tmp/goal16-investigate/timer-window/bundle`

Facts:

- source command: non-root `/usr/bin/ping -i 1 127.0.0.1`;
- native capture at settle `950ms` stopped in active `recvmsg` fd `3`;
- thread: `thread:23`;
- active syscall: `recvmsg`, number `212`;
- args: fd `0x3`, msghdr pointer `0xffffc2b8d390`, flags `0x0`;
- signal: blocked `0`, pending `0`, activeFrame `false`, altStack `disabled`;
- fd `3`: socket `socket:[4552230]`, flags `octal:2`.

Strace facts:

```text
sendto(3, ..., icmp_seq=1, ...) = 64
recvmsg(3, ..., 0) = 64
recvmsg(3, {msg_namelen=128}, 0) = -1 EAGAIN
sendto(3, ..., icmp_seq=2, ...) = 64
setitimer(ITIMER_REAL, {it_value={tv_sec=1, tv_usec=0}}, NULL) = 0
recvmsg(3, ..., 0) = 64
```

Decision: not graduated as a new packet-state subset. This reinforces Goal 15's
empty wait shape, but the sequence/timer transition around the second send still
needs exact ordering gates before it can become a broader multi-interval support
claim.

## Required positive profiles

No new positive profile was added. Each candidate remains intentionally refused:

- [x] `real-distro-ping-socket-loopback-known-inflight-recreate` — not added as
      success; represented by `ping-socket-active-recvmsg-known-inflight-refusal`.
- [x] `real-distro-ping-socket-loopback-known-unread-reply-recreate` — not added
      as success; represented by
      `ping-socket-active-recvmsg-known-unread-reply-refusal`.
- [x] `real-distro-ping-socket-loopback-multi-interval-recreate` — not added as
      success; represented by `ping-socket-active-recvmsg-multi-interval-refusal`.

This satisfies the goal's positive-profile rule by documenting why every
candidate state remains unsafe and keeping all candidates refused.

## Required refusal profiles

Target-native negative coverage for unsupported neighboring states:

- [x] multiple in-flight echo requests:
      `ping-socket-active-recvmsg-multiple-inflight-refusal`.
- [x] unread queue with more than one reply:
      `ping-socket-active-recvmsg-multiple-unread-replies-refusal`.
- [x] unread reply with mismatched ICMP id/sequence:
      `ping-socket-active-recvmsg-id-sequence-mismatch-refusal`.
- [x] non-loopback destination:
      `ping-socket-active-recvmsg-nonloopback-refusal`.
- [x] ICMPv6: `ping-socket-active-recvmsg-icmpv6-refusal`.
- [x] unsupported `recvmsg` flags:
      `ping-socket-active-recvmsg-flags-control-refusal`.
- [x] unsupported control-message/ancillary-data requirements:
      `ping-socket-active-recvmsg-flags-control-refusal`.
- [x] unsupported socket options or BPF/filter state:
      `ping-socket-active-recvmsg-unsupported-option-refusal`.
- [x] ambiguous timer/signal delivery order:
      `ping-socket-active-recvmsg-signal-timer-refusal` and
      `ping-socket-active-recvmsg-multi-interval-refusal`.
- [x] hidden source-side helper or source network dependency:
      `ping-socket-active-recvmsg-hidden-sidecar-refusal`.

All new refusal proofs passed with `target-socket-syscall-state-unsupported`,
`descriptorGateCompleted=true`, and `migrationCompleted=false`.

## Validation performance requirement

- [x] Measured every proof/check/test command with wall-clock timings.
- [x] Preserved sub-step timings for the remote distro ping proof.
- [x] Implemented a validation-speed improvement: the arm64 source host now
      caches a prebuilt `machinen-distro-ping-proof:ubuntu-24.04` image with
      `iputils-ping`, `strace`, `util-linux`, and `libcap2-bin` installed and
      `/usr/bin/ping` file capability removed. The smoke script builds it only
      if missing, then reuses it for distro ping captures.
- [x] Measured improvement: image build/ensure took 6.953s the first time; Goal 15's uncached distro proof took 56.473s total and 20.756s capture; Goal 16's cached distro proof after final refactor took 51.523s total and 16.830s capture, saving 4.950s total and 3.926s capture on the measured run.
- [x] Follow-up candidate: batch target-native negative profiles into one VM
      boot. It was not implemented here because the existing proof runner treats
      each profile as an independent smoke run with its own summary/artifact
      contract; changing that would affect matrix accounting more broadly.

## Required implementation tasks

- [x] No descriptor/schema/resource metadata was extended because no new success
      subset was selected.
- [x] No active syscall policy expansion was added beyond Goal 15 because known
      in-flight/unread/multi-interval states remain refused.
- [x] No target trampoline packet/timer behavior was added because no packet
      state subset was selected.
- [x] Target verifier gate requirements for ICMP id/sequence continuity,
      next-packet behavior, queue/in-flight state, and timer/signal policy were
      documented as blockers for future graduation.
- [x] Focused tests were updated for proof profile counts and matrix coverage.
- [x] Updated proof profiles, support docs, and proof matrices.
- [x] Recorded proof artifacts and validation timings in this file.

## Proof requirements

Done status:

- [x] No new success profile was claimed. The existing Goal 15 positive profile
      was re-run after the validation-speed improvement and still restored
      target-natively on amd64.
- [x] `migrationCompleted=true` appears only in the existing accepted Goal 15
      distro ping subset after descriptor/resource gates and all target verifier
      gates pass.
- [x] The proof path does not use source-ISA emulation, runtime sidecar success,
      app hooks, source text replay, or hidden source-side network dependency.
- [x] Unsupported packet/timer/control variants refuse with stable codes and
      `migrationCompleted=false`.
- [x] The support envelope remains explicitly bounded to Goal 15's accepted
      subset; Goal 16 packet/timer candidates remain refused.
- [x] Validation timings and speed-improvement results are recorded.

## Validation timings

| Category           | Command/proof                                                                                                                                                                                              |    Time | Result                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------: | ---------------------------------------------- |
| Matrix/schema      | `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`                                                                                                                                  |  0.170s | passed                                         |
| Local focused      | `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run native-active-syscall-policy.test.ts portable-machine-proof-runner.test.ts portable-machine-proof-matrix.test.ts`                                          |  3.302s | passed                                         |
| Remote image cache | ensure/build `machinen-distro-ping-proof:ubuntu-24.04` on `friend@100.126.46.90`                                                                                                                           |  6.953s | passed                                         |
| Remote proof       | `real-distro-ping-socket-loopback-recreate` with cached source image                                                                                                                                       | 51.523s | passed                                         |
| Remote negative    | `ping-socket-active-recvmsg-multiple-inflight-refusal`                                                                                                                                                     | 36.111s | passed                                         |
| Remote negative    | `ping-socket-active-recvmsg-multiple-unread-replies-refusal`                                                                                                                                               | 36.150s | passed                                         |
| Remote negative    | `ping-socket-active-recvmsg-id-sequence-mismatch-refusal`                                                                                                                                                  | 36.530s | passed                                         |
| Remote negative    | `ping-socket-active-recvmsg-icmpv6-refusal`                                                                                                                                                                | 36.059s | passed                                         |
| Remote negative    | `ping-socket-active-recvmsg-known-inflight-refusal`                                                                                                                                                        | 36.439s | passed                                         |
| Remote negative    | `ping-socket-active-recvmsg-known-unread-reply-refusal`                                                                                                                                                    | 35.980s | passed                                         |
| Remote negative    | `ping-socket-active-recvmsg-multi-interval-refusal`                                                                                                                                                        | 36.127s | passed                                         |
| Investigation      | real distro ping first-recvmsg, multi-interval, and timer-window capture/strace probes                                                                                                                     |  8.924s | passed                                         |
| Matrix/schema      | refusal matrix with final checked summaries: `pnpm --silent portable-machine-proof-matrix -- --preset refusal --check-summary-dir /tmp/refusal-summaries-16-final --json --continue-on-fail`               | 31.903s | passed; 149 refusal profiles                   |
| Matrix/schema      | foundation matrix with final checked summaries: `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-16-final --json --continue-on-fail` |  4.184s | passed; 188 profiles, 39 success, 149 refusals |
| Local static       | `pnpm run format:check`                                                                                                                                                                                    |  0.643s | passed                                         |
| Local static       | `pnpm run lint`                                                                                                                                                                                            |  0.184s | passed                                         |
| Docs/API           | `pnpm run build:docs`                                                                                                                                                                                      |  1.478s | passed                                         |
| Local static       | `pnpm run typecheck`                                                                                                                                                                                       |  1.992s | passed                                         |
| Local unit tests   | `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`                                                                                                                                                           | 26.914s | passed                                         |
| Architecture audit | `pnpm exec fallow audit --changed-since origin/main`                                                                                                                                                       |  0.371s | passed                                         |
| Whitespace         | `git diff --check`                                                                                                                                                                                         |  0.017s | passed                                         |

Full smoke tests were not run for the current Goal 16 delta because the final
code change is proof-profile/smoke validation plumbing and docs; VM/VMM, rootfs,
assets, CLI boot/exec/mount, snapshot/restore runtime behavior, virtio devices,
memory/ballooning, and FUSE/live mounts were not changed after Goal 15's full
smoke validation.

## Final inventory

- 188 profiles total;
- 39 expected success profiles;
- 149 expected refusal profiles;
- support status counts: 11 baseline success, 28 graduated support, 146
  intentional refusal, 3 permanent refusal.

## Starting boundary

Goal 15 is the baseline: one real distro ping active `recvmsg` empty-queue proof
is already supported. Goal 16 determines that known in-flight/unread and
multi-interval packet/timer states are still unsafe without exact packet/timer
verifier gates, keeps them refused with target-native evidence, and makes distro
ping validation faster through a cached source proof image.
