# Goal 13: Linux ping-socket portable snapshot contract

Parent context: [`goal-12.md`](./goal-12.md) graduated the narrow raw ICMP
loopback contract for `AF_INET` / `SOCK_RAW` / `IPPROTO_ICMP` with
`CAP_NET_RAW`. This goal targets the common Linux ping-socket shape used by many
`ping` implementations: `AF_INET` / `SOCK_DGRAM` / `IPPROTO_ICMP` authorized by
`ping_group_range` and process credentials instead of raw-socket capability.

## Objective

Prove a real arm64 ping-socket workload can be captured into a portable machine
snapshot and restored into an amd64 VM with target-native ping-socket behavior,
without source-ISA emulation, runtime sidecar success, app hooks, source text
replay, or hidden source-side network dependency.

The first accepted subset remains deliberately narrow: one IPv4 loopback ICMP
echo ping socket, no in-flight packet ambiguity, no arbitrary route migration,
no unread packet queue, and no unsupported socket options. Everything outside the
exact contract must continue to refuse with stable codes and
`migrationCompleted=false`.

## Proposed accepted subset: `ping-socket-v1:loopback-echo-no-inflight`

- Exactly one IPv4 Linux ping socket: `AF_INET`, `SOCK_DGRAM`,
  `IPPROTO_ICMP`.
- Destination limited to loopback, initially `127.0.0.1`.
- No in-flight echo request/response at capture.
- No unread packet queue at capture unless explicitly modeled later.
- ICMP id/sequence state is captured and verified.
- Target route is target-local loopback only.
- Socket options limited to an allowlist required by the fixture or real
  `/bin/ping` proof.
- Credential policy is explicit: captured uid/gid/group set must be authorized by
  target `net.ipv4.ping_group_range`, or restoration must refuse before
  descriptor/resource gates complete.
- Target recreates the socket with target-native syscalls and proves echo
  behavior through target-side verifier actions.

## Non-goals for the first subset

- Raw sockets or `CAP_NET_RAW` expansion beyond Goal 12.
- Non-loopback destinations.
- Cross-network-namespace route preservation.
- Internet reachability or DNS.
- ICMPv6.
- Broadcast/multicast.
- In-flight packet replay.
- Preserving arbitrary kernel packet queues.
- BPF filters, marks, custom routing tables, `IP_HDRINCL`, raw IP packet
  crafting, or unknown socket options.
- Setuid/capability inheritance claims beyond the explicit ping-socket
  credential/range contract.
- A source-side helper, source namespace, or target sidecar that is not declared
  as verifier-only proof infrastructure.

## Required portable descriptor fields

- Socket family/type/protocol for the accepted ping-socket flavor.
- Source fd, target fd policy, close-on-exec/nonblocking flags.
- Credential model: uid, gid, supplementary groups if relevant, and the accepted
  target `ping_group_range` proof.
- Network namespace provenance and accepted remap policy.
- Bind/local address if any.
- Destination address, initially loopback-only.
- ICMP id and sequence baseline.
- Packet queue/in-flight state marker, initially empty-only.
- Socket option allowlist and captured values.
- Route provenance sufficient for target-local loopback verification.
- Verifier recipe and expected target-native packet behavior.

## Tasks

- [ ] Add a real source fixture for a C ping-socket workload, or use a tightly
      controlled distro `/bin/ping -c 1 127.0.0.1` proof if capture stability is
      sufficient.
- [ ] Decide and document whether the first positive proof uses the fixture,
      distro `/bin/ping`, or both as separate profiles.
- [ ] Capture/classify ping-socket resources and reject unsupported neighboring
      states before descriptor/resource gates complete.
- [ ] Emit `ping-socket-v1` portable descriptor fields for the exact accepted
      loopback subset.
- [ ] Add target-native recreation recipe with explicit target
      `ping_group_range` and credential gates.
- [ ] Add target verifier for loopback route, ICMP id/sequence, echo send/recv,
      no packet queue ambiguity, allowed options, and no hidden source-side
      dependency.
- [ ] Add positive proof profile, tentatively `real-ping-socket-loopback-recreate`,
      only after the full descriptor and verifier exist.
- [ ] Keep neighboring negative profiles for: missing ping-group permission,
      wrong uid/gid/group provenance, raw-socket-only capability confusion, wrong
      namespace, stale route, non-loopback destination, id/sequence mismatch,
      in-flight packet ambiguity, unread packet queue, unsupported socket
      options, BPF/filter state, ICMPv6, and hidden sidecar/source dependency.
- [ ] Update support matrices, refusal inventory, and proof matrix docs with the
      exact accepted subset and refusal boundaries.

## Proof requirements

Done only when all are true:

- A real arm64 ping-socket workload restores on amd64 with target-native
  completion.
- `migrationCompleted=true` is set only after descriptor/resource gates and all
  target verifiers pass.
- The target verifier proves loopback ICMP echo behavior using target-native
  actions.
- Target `ping_group_range` and credential gates are explicit and verified.
- Network namespace and route provenance are bounded to the accepted loopback
  contract.
- No source-ISA emulation, runtime sidecar success, app hooks, source text
  replay, or hidden source-side network dependency is used.
- Unsupported neighboring states refuse with stable codes and
  `migrationCompleted=false`.
- If the exact contract cannot be completed, ping sockets remain refused and this
  goal is not claimed as positive support.

## Required validation

Record timings for every command/proof:

- schema validation for proof profiles;
- focused ping-socket credential/range and namespace tests;
- focused resource translation and target guest restore loader tests;
- remote arm64->amd64 proof for the positive ping-socket profile if added;
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

Goal 12 proves only the raw-socket `CAP_NET_RAW` loopback contract. Linux
ping-socket state remains unsupported until this goal supplies an exact
credential/range descriptor, target-native restore recipe, verifier, positive
arm64->amd64 proof, and nearby fail-closed refusal profiles.
