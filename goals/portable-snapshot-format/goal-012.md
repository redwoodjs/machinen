# Goal 12: raw ICMP / `ping` portable snapshot contract

Parent context: Goal 11.4 kept raw ICMP fail-closed by
`raw-icmp-ping-refusal`. This goal is the follow-up that may graduate one exact
raw ICMP / ping subset from refusal to target-native restore support.

## Objective

Prove a real arm64 `ping`-shaped workload can be captured into a portable
machine snapshot and restored into an amd64 VM with target-native raw ICMP / ping
socket behavior, without source-ISA emulation, runtime sidecar success, app
hooks, source text replay, or hidden source-side network dependency.

The first accepted subset should be deliberately narrow: one loopback ICMP echo
socket, no in-flight packet ambiguity, no arbitrary route migration, and no
unsupported socket options. Everything outside the exact contract must continue
to refuse with stable codes and `migrationCompleted=false`.

## Accepted subset: `raw-icmp-v1:loopback-echo-no-inflight`

- Exactly one IPv4 ICMP echo socket.
- Destination limited to loopback, initially `127.0.0.1`.
- No in-flight echo request/response at capture.
- No unread packet queue at capture unless explicitly modeled later.
- ICMP id/sequence state is captured and verified.
- Target route is target-local loopback only.
- Socket options limited to an allowlist required by the fixture.
- Capability policy is explicit: raw socket `AF_INET`, `SOCK_RAW`,
  `IPPROTO_ICMP` with `CAP_NET_RAW` or equivalent target policy. Linux ping
  sockets (`AF_INET`, `SOCK_DGRAM`, `IPPROTO_ICMP`) remain outside this subset
  and are covered by neighboring refusal profiles until a separate
  `ping_group_range`/credential contract exists.
- Target recreates the socket with target-native syscalls and proves echo
  behavior through target-side verifier actions.

## Non-goals for the first subset

- Non-loopback destinations.
- Cross-network-namespace route preservation.
- Internet reachability or DNS.
- ICMPv6.
- Broadcast/multicast.
- In-flight packet replay.
- Preserving arbitrary kernel packet queues.
- BPF filters, marks, custom routing tables, `IP_HDRINCL`, raw IP packet
  crafting, or unknown socket options.
- TLS/session/application protocol claims layered above ICMP.
- A source-side helper, source namespace, or target sidecar that is not declared
  as verifier-only proof infrastructure.

## Required portable descriptor fields

- Socket family/type/protocol for the accepted raw ICMP socket flavor.
- Source fd, target fd policy, close-on-exec/nonblocking flags.
- Capability model: `CAP_NET_RAW` for the accepted raw socket flavor.
- Network namespace provenance and accepted remap policy.
- Bind/local address if any.
- Destination address, initially loopback-only.
- ICMP id and sequence baseline.
- Packet queue/in-flight state marker, initially empty-only.
- Socket option allowlist and captured values.
- Route provenance sufficient for target-local loopback verification.
- Verifier recipe and expected target-native packet behavior.

## Tasks

- [x] Add a real source fixture for a small C ping/raw-ICMP workload (`packages/microvm/test-fixtures/proof-assets/native-raw-icmp-target.c`).
- [x] Decide and document the first socket flavor: raw socket with `CAP_NET_RAW`; Linux ping sockets remain a neighboring refusal boundary.
- [x] Capture/classify ICMP socket resources and reject unsupported neighboring states before descriptor/resource gates complete.
- [x] Emit `raw-icmp-v1` portable descriptor fields for the exact accepted loopback subset.
- [x] Add target-native recreation recipe with explicit `CAP_NET_RAW` gate.
- [x] Add target verifier for loopback route, ICMP id/sequence, echo send/recv, no packet queue ambiguity, allowed options, and no hidden source-side dependency.
- [x] Add positive proof profile `real-raw-icmp-loopback-recreate` after the descriptor and verifier landed.
- [x] Keep `raw-icmp-ping-refusal` and add nearby negative profiles for missing capability, disallowed ping group, wrong namespace, stale route, non-loopback destination, id/sequence mismatch, in-flight packet ambiguity, unread packet queue, unsupported socket options, BPF/filter state, `IP_HDRINCL`, ICMPv6, and hidden sidecar/source dependency.
- [x] Update support matrices, refusal inventory, and proof matrix docs with the exact accepted subset and refusal boundaries.

## Proof requirements

Done only when all are true:

- A real arm64 raw ICMP / ping workload restores on amd64 with target-native
  completion.
- `migrationCompleted=true` is set only after descriptor/resource gates and all
  target verifiers pass.
- The target verifier proves loopback ICMP echo behavior using target-native
  actions.
- Capability or ping-socket permission gates are explicit and verified on the
  target.
- Network namespace and route provenance are bounded to the accepted loopback
  contract.
- No source-ISA emulation, runtime sidecar success, app hooks, source text
  replay, or hidden source-side network dependency is used.
- Unsupported neighboring states refuse with stable codes and
  `migrationCompleted=false`.
- If the exact contract cannot be completed, raw ICMP remains refused by
  `raw-icmp-ping-refusal` and this goal is not claimed as positive support.

## Required validation

Record timings for every command/proof:

- schema validation for proof profiles;
- focused raw-socket / ping-socket capability and namespace tests;
- focused resource translation and target guest restore loader tests;
- remote arm64->amd64 proof for the positive raw ICMP profile if added;
- refusal matrix;
- foundation matrix;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run typecheck`;
- `pnpm run build:docs` if public docs/API changed;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` or a justified smaller
  focused unit set plus dependent checks;
- `pnpm exec fallow audit --changed-since origin/main`;
- full smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
  changed.

## Starting boundary

This goal started from an intentionally fail-closed state:
`raw-icmp-ping-refusal` refuses with
`target-socket-syscall-state-unsupported`, `migrationCompleted=false`, and
`descriptorGateCompleted=false`. That profile remains the safe fallback for raw
ICMP states outside the completed `raw-icmp-v1` contract.

## Completed proof

- profile: `real-raw-icmp-loopback-recreate`;
- fixture: `packages/microvm/test-fixtures/proof-assets/native-raw-icmp-target.c`;
- accepted subset: `raw-icmp-v1:loopback-echo-no-inflight`;
- source socket flavor: IPv4 raw ICMP socket (`AF_INET`, `SOCK_RAW`, `IPPROTO_ICMP`) with `CAP_NET_RAW`;
- source capability environment: declared proof container on `friend@100.126.46.90` with `NET_RAW` and `SYS_PTRACE`, used only to create/capture the real arm64 raw ICMP process;
- remote source: `friend@100.126.46.90` (`aarch64`);
- remote target: `root@192.168.0.8` (`x86_64`);
- target repo: `/tmp/machinen-goal12-current`;
- target image: `/tmp/machinen-goal12-current/release-assets/rootfs-debian-amd64.tar.gz`;
- VMM: `/tmp/machinen-goal12-current/packages/native-x64-linux/vmm/bin/machinen-vm`;
- target kernel: `/tmp/machinen-goal12-current/release-assets/bzImage-x86_64`;
- target raw ICMP fd: `58`;
- ICMP identifier: `0x4d49`;
- ICMP sequence: `1`;
- continuation sha256: `eedba20298778e20676a77c0df121e5e7361c1e87e1f443309cf3057872fc401`;
- descriptor sha256: `78a938d40a684cfbf57cfee6ded68432e951f5c6a6a20106f9f07c6e8b5cd189`;
- validation timing: 44.184s, passed.

The target restore result completed with `migrationCompleted=true`,
`descriptorGateCompleted=true`, target verifier and state-consumption gates
passed, `synthetic-raw-icmp` resource status passed, the source/target probe code
actively drained residual ICMP packets before claiming the empty-queue model, and
no source-ISA emulation, runtime sidecar success, app hooks, or source text
replay.

## Validation timings

- Remote real proof (`real-raw-icmp-loopback-recreate`): 44.184s, passed.
- `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`: 0.178s, passed.
- `pnpm --silent portable-machine-proof-matrix -- --preset refusal --json --continue-on-fail`: 2.796s, passed (115 refusal profiles).
- `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-12-drain-final --json --continue-on-fail`: 3.494s, passed (151 profiles; 36 success, 115 refusal).
- Focused Vitest (`native-resource-translation`, `target-guest-restore-loader`, `portable-machine-proof-runner`): 3.720s, passed (134 tests).
- Full unit tests (`NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`): 27.096s, passed.
- `pnpm run format:check`: 0.620s, passed.
- `pnpm run lint`: 0.207s, passed.
- `pnpm run build:docs`: 1.614s, passed.
- `pnpm run typecheck`: 2.277s, passed.
- `pnpm exec fallow audit --changed-since origin/main`: 0.210s, passed.
- `pnpm exec fallow audit`: 0.402s, passed with existing duplicate clone-group warnings only.
- `git diff --check`: 0.023s, passed.
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`: 132.596s, passed.
