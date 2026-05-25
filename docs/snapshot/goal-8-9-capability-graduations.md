# Goal 8/9 app-neutral capability graduations

Goals 8 and 9 add app-neutral support subsets as proof-profile capabilities. A
success claim remains valid only after target-native completion, descriptor
consumption, verifier gates, no source-ISA emulation, no runtime sidecar success,
no app hooks, and no source text replay.

## Goal 8 graduated subsets

- `tcp-listener-v1:loopback-no-accepted-connections` (`tcp-listener-recreate`):
  one loopback TCP listener with recorded bind policy, backlog, allowed socket
  options, fd flags, empty accept-queue proof, target-native `socket/bind/listen`,
  and verifier checks for `SO_ACCEPTCONN`, local address/port, flags, remap, and
  no accepted peers.
- `private-layout-v2:multi-anonymous-data-ranges-with-guards`
  (`private-multi-range-recreate`): multiple private RW non-executable ranges
  with range ids, captured hashes, target placement, guard pages, and relocation
  ownership checks.
- `epoll-graph-v1:acyclic-level-triggered-eventfd-and-pipe`
  (`epoll-graph-recreate`): one acyclic level-triggered epoll graph over accepted
  fds with interest-list, data payload, readiness, and no unexpected-event gates.
- `file-backed-private-mapping-v1:nonexec-private-dirty-overlay`
  (`file-backed-private-mapping-recreate`): private non-executable file mapping
  from target file identity plus dirty overlay bytes, digest/build-id checks, and
  permissions gates.
- `active-syscall-eintr-v1:ppoll-timeout-no-signal-delivery`
  (`active-syscall-eintr-recreate`): deterministic `-EINTR` completion for an
  allowed active syscall with no pending delivery/frame/alt-stack and final mask
  verification.

Nearby negative profiles refuse active/queued sockets, unsupported socket
options, aliases, overlapping/stale/W+X memory, guard mismatches, bad relocation
provenance, epoll cycles/edge/one-shot/stale watches/ambiguous ready lists,
missing or mismatched file provenance, shared/executable mappings, restart blocks,
pending signals, active frames, alt-stacks, unsupported interrupted syscalls, and
ambiguous remaining time.

## Goal 11 real workload graduation

- `real-private-layout-v2:multi-anonymous-data-ranges-with-guards-and-regular-file-fd`
  (`real-private-multi-range-file-recreate`): a real arm64 C workload with two
  private anonymous writable non-executable data ranges, guard pages, and a
  regular-file active read fd captured remotely and restored target-natively on
  amd64. The proof uses the private-layout verifier gates plus regular-file fd
  state and keeps stale ranges, guard mismatch, W+X/shared mappings, bad
  relocation, and invalid file provenance refused.
- `real-tcp-listener-v1:loopback-no-accepted-connections`
  (`real-tcp-listener-recreate`): a real arm64 C workload with a loopback TCP
  listener and no accepted peers, restored as a target-native amd64 listener with
  `SO_ACCEPTCONN` and not-ready verifier gates.
- `real-tcp-listener-readiness-v1:no-queued-accept-target-probe`
  (`real-tcp-listener-readiness-recreate`): the listener readiness proof extends
  the restored listener with a verifier-owned target-side client and proves the
  readiness transition without migrating a source client.
- `real-tcp-active-connection-v1:single-plain-stream-explicit-broker`
  (`real-tcp-active-connection-transport-recreate`): a real arm64 active TCP
  workload restored through a declared target-loopback peer broker; the target
  verifier proves unread bytes and reply delivery through that declared broker.

## Goal 9 graduated subsets

- `tcp-active-connection-v1:single-plain-stream-explicit-broker`
  (`tcp-active-connection-transport-recreate`): exactly one plain TCP stream with
  endpoint identity, buffers, half-close state, allowed options, declared broker
  id/path/hash/arch/namespace/mode, and verifier read/write/EOF gates.
- `tcp-listener-readiness-v1:no-queued-accept-target-probe`
  (`tcp-listener-readiness-recreate`): Goal 8 listener readiness verified before
  and after a target-side probe client, without accepting queued source accepts.
- `futex-private-v1:one-waiter-one-wake`
  (`futex-private-wait-wake-recreate`): one private futex word, one waiter, one
  wake, deterministic ordering, final word, and thread gate verification.
- `rseq-lifecycle-v1:absent-or-target-registered-no-critical-section`
  (`rseq-absent-or-target-registered-recreate`): explicit rseq absence or
  target-owned registration with TLS ownership and no active critical section.
- `shared-memory-v1:single-memfd-declared-participant`
  (`shared-memory-contract-recreate`): one memfd-backed shared mapping with
  participant set, seals, permissions, dirty bytes, and visibility verification.

Transport profiles record broker provenance in the runner artifact. Futex, rseq,
and shared-memory profiles record synchronization verifier events. Missing,
stale, wrong-arch, undeclared, or namespace-mismatched helpers remain refusal
profiles and never count as target process completion.
