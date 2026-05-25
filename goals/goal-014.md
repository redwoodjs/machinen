# Goal 14: Distro ping and non-root ping-socket hardening

Parent context: [`goal-013.md`](./goal-013.md) graduated the first Linux
ping-socket portable snapshot subset with a real C fixture:
`ping-socket-v1:loopback-echo-no-inflight`. That proof used uid/gid `0` and
validated neighboring refusal profiles through the proof matrix. This goal keeps
that contract intact and proves it also holds for the common user-facing shape:
a distro `/bin/ping` workload, an unprivileged credential inside
`net.ipv4.ping_group_range`, and selected target-native negative VM runs.

## Objective

Prove that the Goal 13 ping-socket contract is not only a purpose-built C
fixture success. It must also cover a real distro `/bin/ping` ping-socket
workload, and it must prove the reason Linux ping sockets exist: an unprivileged
uid/gid can use `AF_INET` / `SOCK_DGRAM` / `IPPROTO_ICMP` when the target
`ping_group_range` policy allows it.

Also harden the refusal boundary by running selected unsafe ping-socket states
through the target-native VM restore path and proving they refuse before
migration completion.

## Accepted subset

The accepted support subset remains:

- `ping-socket-v1:loopback-echo-no-inflight`

This goal may add stronger positive profiles inside that same subset. It must
not silently expand the accepted socket state beyond Goal 13.

Allowed positive shapes for this goal:

1. **Distro `/bin/ping` loopback proof**
   - Source workload is a real distro ping implementation, initially
     `/bin/ping -c 1 127.0.0.1` or the equivalent resolved path in the source
     container/rootfs.
   - The captured socket must be a Linux ping socket:
     `AF_INET`, `SOCK_DGRAM`, `IPPROTO_ICMP`.
   - The proof must not depend on source text replay, a source-side helper, or a
     runtime sidecar success path.

2. **Non-root ping-socket credential proof**
   - Source workload runs as a non-root uid/gid.
   - Source and target `ping_group_range` policy explicitly allows that gid.
   - The descriptor records uid/gid/group policy provenance.
   - The target recreates the ping socket with target-native syscalls and proves
     the target gid is inside the target `ping_group_range` before success.

3. **Target-native negative VM proof set**
   - A selected subset of neighboring ping-socket refusal profiles runs through
     the VM restore path, not only schema/matrix validation.
   - Each selected refusal must finish with a stable refusal code and
     `migrationCompleted=false`.

## Non-goals

- Expanding to non-loopback destinations.
- Internet reachability, DNS, broadcast, multicast, or route migration.
- ICMPv6 support.
- In-flight packet replay or unread receive-queue preservation.
- Raw socket or `CAP_NET_RAW` expansion beyond Goal 12.
- Preserving arbitrary `/bin/ping` process details that are outside the
  ping-socket contract, such as terminal UI behavior or distro-specific helper
  state.
- Claiming support for setuid/capability inheritance beyond the explicit
  ping-socket uid/gid/`ping_group_range` policy.

## Required positive profiles

Add positive profiles only after their descriptor, restore recipe, and verifier
paths exist.

- [ ] `real-distro-ping-socket-loopback-recreate`
  - Real arm64 distro `/bin/ping` workload.
  - Restored into an amd64 VM.
  - Uses target-native ping-socket behavior.
  - Completes with `migrationCompleted=true` only after descriptor/resource
    gates and target verifier gates pass.

- [ ] `real-nonroot-ping-socket-loopback-recreate`
  - Real arm64 workload running as a non-root uid/gid.
  - Captured gid is inside the declared source policy and target
    `ping_group_range`.
  - Restored into an amd64 VM as a target-native ping socket.
  - Verifies uid/gid/range policy before success.

These profiles may share a workload if the distro `/bin/ping` proof is also the
non-root proof. If they are combined, the profile metadata and goal audit must
make that explicit.

## Required target-native refusal profiles

Choose a small but representative hardening set from the Goal 13 neighboring
refusals and run them through the target VM restore path. At minimum cover:

- [ ] missing or disallowing target `ping_group_range`;
- [ ] uid/gid or group-policy mismatch;
- [ ] non-loopback destination;
- [ ] in-flight packet ambiguity or unread queue ambiguity;
- [ ] unsupported ping-socket option or BPF/filter state;
- [ ] hidden source-side dependency.

Each negative VM proof must show:

- stable refusal code, expected initially:
  `target-socket-syscall-state-unsupported`;
- `migrationCompleted=false`;
- no target-native success marker;
- no source-ISA emulation;
- no runtime sidecar success;
- no app hook or source text replay.

## Tasks

- [ ] Identify the source distro image/rootfs that supplies `/bin/ping` and
      document its implementation mode.
- [ ] Prove the source `/bin/ping` opens a Linux ping socket rather than a raw
      socket for the chosen uid/gid and policy.
- [ ] Add capture support for the distro `/bin/ping` workload without relying on
      host execution of guest-only binaries.
- [ ] Add non-root source execution in the arm64 proof environment with explicit
      uid/gid and `ping_group_range` setup.
- [ ] Ensure the target restore path verifies non-root uid/gid/group policy and
      target `ping_group_range` before `migrationCompleted=true`.
- [ ] Add or extend portable descriptor fields only if needed for real distro
      ping; keep unsupported extra state fail-closed.
- [ ] Add target-native VM negative proof plumbing for the selected refusal
      profiles.
- [ ] Update proof profiles, support docs, refusal inventory, and proof matrices
      with the new positive and target-native negative coverage.
- [ ] Record proof artifacts and timings in this goal file before completion.

## Proof requirements

Done only when all are true:

- A real arm64 distro `/bin/ping` ping-socket workload restores on amd64 with
  target-native completion, or this goal explicitly keeps distro ping unsupported
  and does not claim the positive profile.
- A real arm64 non-root ping-socket workload restores on amd64 with target-native
  completion and explicit uid/gid/`ping_group_range` verifier gates.
- `migrationCompleted=true` is set only after descriptor/resource gates and all
  target verifier gates pass.
- Selected unsafe ping-socket neighboring states are exercised through the
  target-native VM restore path and refuse with stable codes before migration
  completion.
- No source-ISA emulation, runtime sidecar success, app hooks, source text
  replay, or hidden source-side network dependency is used.
- The accepted support envelope remains bounded to
  `ping-socket-v1:loopback-echo-no-inflight` unless a separate future goal
  explicitly expands it.

## Required validation

Record timings for every command/proof:

- schema validation for proof profiles;
- focused ping-socket descriptor, credential/range, and namespace tests;
- focused target guest restore loader/trampoline tests;
- remote arm64->amd64 proof for distro `/bin/ping` if added;
- remote arm64->amd64 proof for non-root ping socket if added;
- target-native VM negative proofs for the selected refusal set;
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

Goal 13 already proves one real C ping-socket fixture with uid/gid `0`. The next
risk is that this success is too fixture-shaped. This goal closes that gap by
proving a real distro `ping` shape, proving non-root credential policy, and
turning selected ping-socket refusal cases into target-native VM proofs.
