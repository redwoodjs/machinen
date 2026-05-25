# Goal 15: Distro ping active recvmsg portable snapshot contract

Parent context: [`goal-014.md`](./goal-014.md) proved that Ubuntu
`iputils-ping` at `/usr/bin/ping` opens a Linux ping socket as a non-root user
under `net.ipv4.ping_group_range`, but it remained an intentional refusal. The
captured live process was blocked in active `recvmsg`/signal-timer state, which
is outside the current `ping-socket-v1:loopback-echo-no-inflight` contract.

## Objective

Graduate the distro `/usr/bin/ping` proof from refusal to positive support by
modeling the narrow active `recvmsg` state that appears after a loopback echo
reply has been consumed and the process is waiting for the next ping interval.
The proof must restore a real arm64 distro ping workload into an amd64 VM with
target-native ping-socket behavior, without source-ISA emulation, runtime
sidecar success, app hooks, source text replay, or hidden source-side network
dependency.

## Proposed accepted subset

Extend the existing ping-socket contract with a deliberately narrow active
receive wait subset:

- `ping-socket-v2:loopback-echo-active-recvmsg-empty-queue`

Required shape:

- Source workload is real distro `/usr/bin/ping`, initially Ubuntu
  `iputils-ping`.
- Workload runs as non-root uid/gid allowed by source and target
  `ping_group_range`.
- Socket is IPv4 Linux ping socket: `AF_INET`, `SOCK_DGRAM`, `IPPROTO_ICMP`.
- Destination is loopback only, initially `127.0.0.1`.
- Active syscall is `recvmsg` on the accepted ping-socket fd.
- The receive queue is proven empty at capture, or the exact queued packet state
  is modeled by this goal before claiming success.
- No in-flight packet ambiguity beyond a target-side deterministic wait/retry
  contract.
- Signal/timer state used by distro ping is bounded and verified, not ignored.
- Target recreates the ping socket with target-native syscalls, verifies
  credentials and target `ping_group_range`, and resumes the active `recvmsg`
  state with deterministic target behavior.

## Non-goals

- Non-loopback destinations.
- Internet reachability, DNS, broadcast, multicast, or route migration.
- ICMPv6.
- Raw socket or `CAP_NET_RAW` expansion beyond Goal 12.
- Arbitrary packet queue replay.
- Arbitrary `recvmsg` support for unrelated sockets.
- BPF filters, unsupported socket options, marks, custom routing tables, or
  source network namespace preservation.
- Claiming distro ping support by launching a fresh target ping process or by
  source text replay.

## Required positive profile

Add only after descriptor, restore, and verifier support exists:

- [ ] `real-distro-ping-socket-loopback-recreate`
  - Real arm64 distro `/usr/bin/ping` workload.
  - Non-root uid/gid inside `ping_group_range`.
  - Captured active `recvmsg` on ping socket.
  - Restored into amd64 VM with target-native socket and active syscall state.
  - Completes with `migrationCompleted=true` only after descriptor/resource
    gates and target verifier gates pass.

## Required refusal profiles

Keep or add target-native negative coverage for neighboring unsafe states:

- [ ] active `recvmsg` on non-ping socket;
- [ ] active `recvmsg` with non-loopback destination;
- [ ] active `recvmsg` with unread packet queue ambiguity;
- [ ] active `recvmsg` with in-flight echo ambiguity;
- [ ] signal/timer state that cannot be deterministically restored;
- [ ] unsupported `recvmsg` flags/control-message requirements;
- [ ] unsupported ping-socket options or BPF/filter state;
- [ ] hidden source-side helper or source network dependency.

Each refusal must show a stable code and `migrationCompleted=false`.

## Tasks

- [ ] Capture and document the exact `/usr/bin/ping` syscall state, fd table,
      signal mask, timer/alarm behavior, and ping-socket metadata at the chosen
      capture point.
- [ ] Decide whether the accepted model resumes the blocked `recvmsg`, returns a
      deterministic target-native packet result, or safely interrupts/rearms the
      wait.
- [ ] Add portable descriptor fields for the accepted active `recvmsg` contract.
- [ ] Add active syscall policy support for ping-socket `recvmsg` only.
- [ ] Add target guest restore/trampoline support for the active ping-socket
      receive wait.
- [ ] Add target verifier gates for queue emptiness, ICMP id/sequence,
      credentials, route/namespace, and signal/timer behavior.
- [ ] Convert `real-distro-ping-socket-loopback-recreate` from intentional
      refusal to graduated support only after the real arm64->amd64 proof passes.
- [ ] Add/update target-native negative VM proofs for the neighboring active
      `recvmsg` states.
- [ ] Update support docs, refusal inventory, proof profiles, and proof matrices.
- [ ] Record all proof artifacts and timings in this goal file before
      completion.

## Proof requirements

Done only when all are true:

- A real arm64 distro `/usr/bin/ping` workload restores on amd64 with
  target-native completion.
- The target restore path proves target-native ping-socket behavior and the
  active `recvmsg` contract.
- `migrationCompleted=true` is set only after descriptor/resource gates and all
  target verifier gates pass.
- The proof does not use source-ISA emulation, runtime sidecar success, app
  hooks, source text replay, or hidden source-side network dependency.
- Unsupported active `recvmsg` and packet queue variants refuse with stable codes
  and `migrationCompleted=false`.
- The support envelope remains loopback-only and explicitly bounded to the
  accepted subset above.

## Required validation

Record timings for every command/proof, and also collect a validation speed
summary so we can decide whether any checks need to be made faster before the
next proof ladder step.

- schema validation for proof profiles;
- focused active `recvmsg` / ping-socket policy tests;
- focused target guest restore loader/trampoline tests;
- remote arm64->amd64 proof for `real-distro-ping-socket-loopback-recreate`;
- target-native VM negative proofs for the selected neighboring active
  `recvmsg` cases;
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

## Validation performance audit

In addition to pass/fail, this goal must measure validation cost.

- [ ] Capture wall-clock timing for every proof, matrix, static check, unit test
      command, and smoke command run for the goal.
- [ ] Split timings into categories: - local static checks; - local unit/focused tests; - matrix/schema checks; - remote arm64 capture; - remote amd64 target VM restore; - full smoke tests.
- [ ] For remote proofs, record sub-step timings from the proof runner when
      available: preflight, capture, bundle, transfer, target boot/restore, and
      completion.
- [ ] Identify the slowest validation steps and record whether each is expected,
      avoidable, or a candidate for optimization.
- [ ] If any single routinely-run validation step takes more than 60 seconds,
      either justify it in this goal or add a follow-up optimization task.
- [ ] If full smoke tests are required, record why they are required and whether
      a smaller future validation target could cover the same risk.
- [ ] Include a final validation timing table in this goal before completion.

## Starting boundary

Goal 14 already proved non-root ping sockets and showed real distro ping opens a
Linux ping socket. The only reason distro ping is not positive support is the
captured active `recvmsg`/signal-timer wait. This goal exists to model that
state precisely or keep it refused with evidence.
