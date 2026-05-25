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

This goal must not dilute Goal 15. Any newly supported shape needs descriptor
fields, target-native restore behavior, target verifier gates, positive remote
arm64->amd64 proof, and nearby target-native negative proofs. If a neighboring
state cannot be modeled precisely, it must keep a stable refusal code and
`migrationCompleted=false`.

## Candidate accepted subsets

Graduate only the subset(s) that receive full proof coverage. Candidate names:

- `ping-socket-v3:loopback-echo-active-recvmsg-known-inflight`
- `ping-socket-v3:loopback-echo-active-recvmsg-known-unread-reply`
- `ping-socket-v3:loopback-echo-multi-interval-sequence-continuity`

Each accepted subset must state exactly:

- source distro and binary path, initially Ubuntu `iputils-ping` at
  `/usr/bin/ping`;
- non-root uid/gid and source/target `ping_group_range` policy;
- IPv4 ping socket shape: `AF_INET`, `SOCK_DGRAM`, `IPPROTO_ICMP`;
- loopback route and destination, initially `127.0.0.1` only;
- ICMP identifier and sequence semantics;
- receive queue state: empty, one known unread reply, or refused;
- in-flight state: none, one known echo request, or refused;
- `recvmsg` flags, `msghdr`, iovec, control buffer, and ancillary-data contract;
- timer/signal interval state and whether it is restored, interrupted, or
  target-side rearmed;
- target-native verifier checks proving the post-restore next packet/timeout
  behavior.

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

## Required investigation

- [ ] Capture real distro ping at multiple points: - before first reply is consumed; - after one consumed reply and blocked wait, as in Goal 15; - after multiple intervals/sequences; - while timer/signal state is active or about to fire.
- [ ] Record strace and native bundle facts for each capture point:
      sockets, fd table, ICMP id/sequence, `recvmsg` msghdr/iovec/control
      buffers, signal masks, pending signals, timer/alarm state, and packet
      queue state.
- [ ] Decide which candidate subset(s) are safe to graduate now and which must
      remain refused.

## Required positive profiles

Add positive profiles only after full descriptor/restore/verifier support exists.
Possible profiles:

- [ ] `real-distro-ping-socket-loopback-known-inflight-recreate`;
- [ ] `real-distro-ping-socket-loopback-known-unread-reply-recreate`;
- [ ] `real-distro-ping-socket-loopback-multi-interval-recreate`.

At least one new positive profile must prove a state not already covered by Goal
15, or this goal must document why every candidate state remains unsafe and keep
all of them refused.

## Required refusal profiles

Add or retain target-native negative coverage for all unsupported neighboring
states:

- [ ] multiple in-flight echo requests;
- [ ] unread queue with more than one reply;
- [ ] unread reply with mismatched ICMP id/sequence;
- [ ] non-loopback destination;
- [ ] ICMPv6;
- [ ] unsupported `recvmsg` flags;
- [ ] unsupported control-message/ancillary-data requirements;
- [ ] unsupported socket options or BPF/filter state;
- [ ] ambiguous timer/signal delivery order;
- [ ] hidden source-side helper or source network dependency.

Each refusal must show a stable code and `migrationCompleted=false`.

## Validation performance requirement

Goal 15 showed that remote active-recvmsg negative proofs cost roughly 36s each
and full smoke tests cost roughly 130s. This goal must include a validation speed
work item, not just measure timings.

- [ ] Measure every proof/check/test/smoke command with wall-clock timings.
- [ ] Preserve sub-step timings for remote proofs: preflight, capture, bundle,
      transfer, target boot/restore, completion.
- [ ] Implement at least one validation-speed improvement if practical, such as: - batching several target-native negative ping proofs into one target VM
      boot; - caching/prebuilding the source distro ping container dependencies; - adding a smaller focused smoke target for active ping-socket recvmsg
      restore.
- [ ] If no speed improvement is practical in this goal, record a concrete
      follow-up task with expected savings and why it was deferred.
- [ ] Include a final timing table and slowest-step analysis before completion.

## Required implementation tasks

- [ ] Extend descriptor/schema/resource metadata only for the selected accepted
      subset(s).
- [ ] Extend active syscall policy only for the selected ping-socket `recvmsg`
      state(s).
- [ ] Extend target guest restore/trampoline behavior for selected packet/timer
      state(s).
- [ ] Add target verifier gates for ICMP id/sequence continuity, next packet or
      timeout behavior, queue/in-flight state, and timer/signal policy.
- [ ] Add focused unit tests for active syscall classification, target active
      restore planning, target guest loader serialization/validation, and native
      resource translation.
- [ ] Update proof profiles, support docs, refusal inventory, proof matrices,
      and API docs.
- [ ] Record all proof artifacts, descriptor hashes, continuation hashes, and
      validation timings in this file.

## Proof requirements

Done only when all are true:

- Any new success profile is backed by a real arm64 distro `/usr/bin/ping`
  workload restored target-natively on amd64.
- `migrationCompleted=true` appears only after descriptor/resource gates and all
  target verifier gates pass.
- The proof does not use source-ISA emulation, runtime sidecar success, app
  hooks, source text replay, or hidden source-side network dependency.
- Unsupported packet/timer/control variants refuse with stable codes and
  `migrationCompleted=false`.
- The support envelope remains explicitly bounded to the accepted subset(s).
- Validation timings and speed-improvement results are recorded.

## Required validation

Record timings for every command/proof:

- schema validation for proof profiles;
- focused distro ping packet-state / active recvmsg tests;
- focused target guest restore loader/trampoline tests;
- remote arm64->amd64 positive proof(s) for newly graduated profile(s);
- target-native VM negative proofs for selected neighboring packet/timer states;
- refusal matrix;
- foundation matrix;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run typecheck`;
- `pnpm run build:docs` if public docs/API changed;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` or a justified focused unit
  set plus dependent checks;
- `pnpm exec fallow audit --changed-since origin/main`;
- full smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
  changed.

## Starting boundary

Goal 15 is the baseline: one real distro ping active `recvmsg` empty-queue proof
is already supported. This goal exists to determine and prove the next safe
packet/timer state, or to keep it refused with target-native evidence while
making validation faster.
