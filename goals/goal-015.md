# Goal 15: Distro ping active recvmsg portable snapshot contract

Parent context: [`goal-014.md`](./goal-014.md) proved that Ubuntu
`iputils-ping` at `/usr/bin/ping` opens a Linux ping socket as a non-root user
under `net.ipv4.ping_group_range`, but it remained an intentional refusal. The
captured live process was blocked in active `recvmsg`/signal-timer state, which
was outside `ping-socket-v1:loopback-echo-no-inflight`.

## Objective

Graduate the distro `/usr/bin/ping` proof from refusal to positive support by
modeling the narrow active `recvmsg` state that appears after a loopback echo
reply has been consumed and the process is waiting for the next ping interval.
The proof restores a real arm64 distro ping workload into an amd64 VM with
target-native ping-socket behavior, without source-ISA emulation, runtime
sidecar success, app hooks, source text replay, or hidden source-side network
dependency.

## Accepted subset

Extended ping sockets with this deliberately narrow active receive wait subset:

- `ping-socket-v2:loopback-echo-active-recvmsg-empty-queue`

Accepted shape:

- Source workload is real Ubuntu `iputils-ping` at `/usr/bin/ping`.
- Workload runs as non-root uid/gid `1000` allowed by source and target
  `ping_group_range`.
- Socket is IPv4 Linux ping socket: `AF_INET`, `SOCK_DGRAM`, `IPPROTO_ICMP`.
- Destination is loopback only, `127.0.0.1`.
- Active syscall is `recvmsg` on source fd `3`.
- Target recreates the ping socket on fd `59`, adopts uid/gid `1000`, verifies
  target `ping_group_range`, and preserves the active receive wait as an empty
  target receive queue with no in-flight packet ambiguity.
- Signal state is bounded to no pending signal, no active signal frame, disabled
  alt stack, and target wait preservation.
- The proof is a semantic target-native continuation for the ping-socket
  `recvmsg` wait. The captured distro process has non-zero SIMD/FPU state; this
  goal does not claim general cross-ISA SIMD/FPU restoration.

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
- General SIMD/FPU state restoration.

## Required positive profile

- [x] `real-distro-ping-socket-loopback-recreate`
  - Real arm64 distro `/usr/bin/ping` workload.
  - Non-root uid/gid inside `ping_group_range`.
  - Captured active `recvmsg` on ping socket.
  - Restored into amd64 VM with target-native socket and active syscall state.
  - Completes with `migrationCompleted=true` only after descriptor/resource
    gates and target verifier gates pass.

## Required refusal profiles

Target-native negative coverage for neighboring unsafe states:

- [x] active `recvmsg` on non-ping socket:
      `ping-socket-active-recvmsg-non-ping-fd-refusal`.
- [x] active `recvmsg` with non-loopback destination:
      `ping-socket-active-recvmsg-nonloopback-refusal`.
- [x] active `recvmsg` with unread packet queue ambiguity:
      `ping-socket-active-recvmsg-unread-queue-refusal`.
- [x] active `recvmsg` with in-flight echo ambiguity:
      `ping-socket-active-recvmsg-inflight-echo-refusal`.
- [x] signal/timer state that cannot be deterministically restored:
      `ping-socket-active-recvmsg-signal-timer-refusal`.
- [x] unsupported `recvmsg` flags/control-message requirements:
      `ping-socket-active-recvmsg-flags-control-refusal`.
- [x] unsupported ping-socket options or BPF/filter state:
      `ping-socket-active-recvmsg-unsupported-option-refusal`.
- [x] hidden source-side helper or source network dependency:
      `ping-socket-active-recvmsg-hidden-sidecar-refusal`.

Each refusal showed `target-socket-syscall-state-unsupported` and
`migrationCompleted=false`; the target-native refusal runs also reached
`descriptorGateCompleted=true` before the intentional target refusal.

## Tasks

- [x] Captured and documented the exact `/usr/bin/ping` syscall state, fd table,
      signal mask, timer/alarm behavior, and ping-socket metadata at the chosen
      capture point.
- [x] Chose target wait preservation: the accepted model preserves the blocked
      `recvmsg` as an empty target receive queue/no-in-flight target-native wait,
      instead of replaying a packet or restarting a source ping process.
- [x] Added portable descriptor fields for the accepted active `recvmsg`
      contract via the ping-socket resource `activeRecvmsg` metadata and native
      active-syscall restore step.
- [x] Added active syscall policy support for ping-socket `recvmsg` only.
- [x] Added target guest restore/trampoline support for the active ping-socket
      receive wait.
- [x] Added target verifier gates for queue emptiness, ICMP id/sequence,
      credentials, route/namespace, and signal state.
- [x] Converted `real-distro-ping-socket-loopback-recreate` from intentional
      refusal to graduated support after the real arm64->amd64 proof passed.
- [x] Added target-native negative VM proofs for the neighboring active
      `recvmsg` states.
- [x] Updated support docs, refusal inventory, proof profiles, proof matrices,
      API docs, and tests.
- [x] Recorded proof artifacts and timings below.

## Captured state evidence

Positive proof workdir:

- `/var/folders/jj/brzmsc2562zbwgzwbnjdnqp80000gn/T/machinen-real-distro-ping-socket-loopback-recreate-proof-6d9df6e56f4df`

Source strace evidence:

```text
socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP) = 3
socket(AF_INET6, SOCK_DGRAM, IPPROTO_ICMPV6) = 4
socket(AF_INET, SOCK_DGRAM, IPPROTO_IP) = 5
sendto(3, ..., 64, 0, {sa_family=AF_INET, sin_addr=inet_addr("127.0.0.1")}, 16) = 64
recvmsg(3, ..., 0) = 64
```

Captured native thread state:

- thread: `thread:205`;
- active syscall: `recvmsg`, syscall number `212`;
- syscall args: fd `0x3`, msghdr pointer `0xffffdb3dcc50`, flags `0x0`;
- signal mask: blocked `0`, pending `0`, activeFrame `false`, altStack
  `disabled`;
- fd `3`: captured socket `socket:[4459441]`, flags `octal:2`;
- fd `4`: captured IPv6 ping socket neighbor, refused outside this IPv4 subset;
- captured SIMD/FPU state: non-zero and therefore not claimed as a general CPU
  state restore by this goal.

Target descriptor evidence:

- remote target descriptor:
  `/tmp/machinen-portable-machine-restore-amd64-real-distro-ping-socket-loopback-recreate-1779714860191/portable-machine/target/combined-target-restore.desc`;
- descriptor sha256:
  `8c1ebf8c4eb4fab10a865a1738f39f0337fca27a8f92fdb56c4a8d022c656b1e`;
- continuation sha256:
  `3ab45c52c769e8d5ec8691cb5b7b465f9b8c2fe233d543d7a01b95f194fc38fd`;
- descriptor resource:
  `resource=synthetic-ping-socket fd=59 identifier=19792 sequence=2 uid=1000 gid=1000 pingGroupRangeStart=0 pingGroupRangeEnd=2147483647 adoptCredentials=true`;
- active syscall step:
  `restore-ping-socket-recvmsg-wait threadId=thread:205 fd=59 sourceFd=3 iovLengthBytes=192 controlLengthBytes=4096 receiveQueue=empty inFlightPackets=none signalTimer=no-pending-signal-frame-target-wait-preserved`.

Positive target result:

- `pass=true`, `state=completed`;
- `migrationCompleted=true`;
- `descriptorGateCompleted=true`;
- `targetVerifierResult=passed`;
- `targetActiveSyscallRestoreResult=passed`;
- target resource statuses all passed, including `synthetic-ping-socket`;
- `sourceIsaEmulationUsed=false`, `sidecarRuntimeUsed=false`,
  `sourceTextReusedAsTargetCode=false`.

## Proof requirements

Done status:

- [x] A real arm64 distro `/usr/bin/ping` workload restores on amd64 with
      target-native completion.
- [x] The target restore path proves target-native ping-socket behavior and the
      active `recvmsg` contract.
- [x] `migrationCompleted=true` is set only after descriptor/resource gates and
      all target verifier gates pass.
- [x] The proof does not use source-ISA emulation, runtime sidecar success, app
      hooks, source text replay, or hidden source-side network dependency.
- [x] Unsupported active `recvmsg` and packet queue variants refuse with stable
      codes and `migrationCompleted=false`.
- [x] The support envelope remains loopback-only and explicitly bounded to the
      accepted subset above.

## Required validation

Recorded timings:

| Category            | Command/proof                                                                                                                                                                                  |     Time | Result                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | --------------------------------------------- |
| Matrix/schema       | `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`                                                                                                                      |   0.176s | passed                                        |
| Local focused tests | focused Vitest for active syscall, target active restore, target guest loader, native resource translation, proof runner, proof matrix                                                         |   3.660s | passed                                        |
| Remote proof        | `real-distro-ping-socket-loopback-recreate`                                                                                                                                                    |  56.473s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-non-ping-fd-refusal`                                                                                                                                               |  36.589s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-nonloopback-refusal`                                                                                                                                               |  36.132s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-unread-queue-refusal`                                                                                                                                              |  36.588s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-inflight-echo-refusal`                                                                                                                                             |  36.235s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-signal-timer-refusal`                                                                                                                                              |  36.603s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-flags-control-refusal`                                                                                                                                             |  36.302s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-unsupported-option-refusal`                                                                                                                                        |  36.294s | passed                                        |
| Remote negative     | `ping-socket-active-recvmsg-hidden-sidecar-refusal`                                                                                                                                            |  36.270s | passed                                        |
| Matrix/schema       | refusal matrix with checked summaries: `pnpm --silent portable-machine-proof-matrix -- --preset refusal --check-summary-dir /tmp/refusal-summaries-15 --json --continue-on-fail`               |   3.268s | passed; 142 refusal profiles                  |
| Matrix/schema       | foundation matrix with checked summaries: `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-15 --json --continue-on-fail` |   4.084s | passed; 181 profiles, 39 success, 142 refusal |
| Local static        | `pnpm run format:check`                                                                                                                                                                        |   0.611s | passed                                        |
| Local static        | `pnpm run lint`                                                                                                                                                                                |   0.182s | passed                                        |
| Docs/API            | `pnpm run build:docs`                                                                                                                                                                          |   1.493s | passed                                        |
| Local static        | `pnpm run typecheck`                                                                                                                                                                           |   2.023s | passed                                        |
| Local unit tests    | `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`                                                                                                                                               |  26.988s | passed                                        |
| Architecture audit  | `pnpm exec fallow audit --changed-since origin/main`                                                                                                                                           |   0.387s | passed                                        |
| Whitespace          | `git diff --check`                                                                                                                                                                             |   0.021s | passed                                        |
| Smoke               | `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`                                                                                                                                | 129.892s | passed                                        |

Positive proof sub-step timings:

| Sub-step             |    Time | Detail                                 |
| -------------------- | ------: | -------------------------------------- |
| arm64 ssh preflight  |  2.523s | `friend@100.126.46.90` reachable       |
| amd64 ssh preflight  |  0.271s | `root@192.168.0.8` reachable           |
| full preflight       |  3.323s | target image and host gates satisfied  |
| remote arm64 capture | 20.756s | distro `/usr/bin/ping` bundle captured |
| bundle               |  0.291s | portable bundle validated              |
| transfer             |  0.530s | bundle copied to amd64 target          |
| target boot/restore  | 28.590s | target-native completion observed      |
| completion           |  0.020s | logs recorded                          |

## Validation performance audit

- [x] Captured wall-clock timing for every proof, matrix, static check, unit test
      command, and smoke command run for the goal.
- [x] Split timings into categories: local static checks, local unit/focused
      tests, matrix/schema checks, remote arm64 capture, remote amd64 target VM
      restore, and full smoke tests.
- [x] Recorded remote proof sub-step timings from the proof runner: preflight,
      capture, bundle, transfer, target boot/restore, and completion.
- [x] Identified slowest validation steps: - full smoke tests: 129.892s, expected because restore/VM behavior changed; - distro ping positive proof: 56.473s, expected and below the 60s routine
      threshold; - active recvmsg negative proofs: ~36s each, expected target VM boot cost; - full Vitest: 26.988s, acceptable.
- [x] Justified the single routinely-run step over 60s: full smoke was required
      because this goal changed snapshot/restore behavior, target guest restore
      active-syscall handling, and the native resume trampoline.
- [x] Future optimization candidate: batch target-native negative profiles in a
      single target VM boot, or cache the distro ping source container package
      installation, if these active recvmsg proofs become routine in every PR.
- [x] Included the final validation timing table above.

## Final inventory

- 181 profiles total;
- 39 expected success profiles;
- 142 expected refusal profiles;
- support status counts: 11 baseline success, 28 graduated support, 139
  intentional refusal, 3 permanent refusal.

## Starting boundary

Goal 14 already proved non-root ping sockets and showed real distro ping opens a
Linux ping socket. Goal 15 models the narrow active `recvmsg`/empty-queue wait
that was missing, graduates the distro ping profile, and keeps neighboring
active receive states fail-closed.
