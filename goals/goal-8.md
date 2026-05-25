# Goal 8: first real-app capability graduations

Goal 7 hardened the app-neutral foundation: the current support envelope is
explicit, proof matrices are one command, target-native provenance is recorded,
profiles map to capabilities, and runtime adapters have a shared boundary. Goal 8
starts using that foundation to graduate the next app-neutral blockers that real
applications commonly need.

The target remains:

```text
arm64 process/app state -> portable machine snapshot -> amd64 VM restore
```

Goal 8 is not a runtime-specific goal. Node, Python, Go, JVM, Ruby, or any other
runtime may consume these capabilities later, but no runtime/app family becomes
supported unless its state maps to graduated app-neutral capabilities and passes
target-native proofs.

Concrete refusal-to-support substeps live in [`goal-8-solved.md`](./goal-8-solved.md).

## Baseline carried forward

The native-transparent success contract remains unchanged:

- target-native completion only;
- no source-ISA emulation as success;
- no Node/Bun/runtime sidecar as success;
- no app hooks;
- no captured source text reused as target code;
- `migrationCompleted=true` only after target-native completion and all required
  target gates pass;
- descriptor/resource gates must pass before completion;
- unsupported state refuses with a stable code and `migrationCompleted=false`.

Goal 7 leaves the proof inventory at:

- 11 `baseline-success` profiles;
- 10 `graduated-support` profiles;
- 32 `intentional-refusal` profiles;
- 3 `permanent-refusal` profiles.

Goal 8 may change those counts only when a track graduates a new supported subset
with the full support-claim checklist and nearby negative profiles.

## Automation rules

- Base each implementation task on `portable-snapshots`.
- Use one issue, one branch, and one PR per support subset.
- Prefer app-neutral capability work over runtime-specific support claims.
- Do not mark any app/runtime family supported by docs alone.
- A new support claim requires:
  - portable state model;
  - target-native restore recipe;
  - target gate/verifier evidence;
  - positive proof automation;
  - nearby negative tests/profiles;
  - docs and validation timings.
- Runtime adapters may describe portable state, but they are not a success path
  unless target-native restore and all gates complete without source-ISA
  emulation, sidecars, app hooks, or source text replay.
- Run full smoke tests whenever VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
  is touched.
- Update `scripts/portable-machine-proof-profiles.json`, capability summaries,
  proof matrix docs, support envelope docs, and validation timings in the same
  change as any support graduation.

## Status legend

- `[x]` todo.
- `[x]` complete and merged.
- `[!]` permanent or intentionally refused invariant.
- `[~]` partial implementation exists but is not yet a supported success claim.

## Track 1: listening TCP sockets with no accepted connections

Goal: graduate the narrow server-socket subset needed by many real apps while
continuing to refuse active network connections and ambiguous kernel state.

First accepted subset:

- one IPv4 or IPv6 TCP listening socket;
- bound to a target-owned address/port policy:
  - loopback-only with exact port reuse, or
  - target-assigned ephemeral port with recorded port remap;
- `listen()` backlog recorded and bounded;
- no accepted connections;
- no pending accept queue entries;
- no in-flight `accept`/`accept4` syscall;
- no socket options outside the modeled allowlist;
- no socket locks, BPF filters, credentials, namespaces, or fd aliases;
- target recipe creates a target-native socket, applies allowed options,
  binds/listens, verifies socket state, and records any target port remap.

Tasks:

- [x] Define `tcp-listener-v1` portable model with address family, bind policy,
      port/remap semantics, backlog, allowed options, fd flags, and refusal
      reasons.
- [x] Extend native resource capture/translation to distinguish inactive
      listening sockets from active connections and queued accept state.
- [x] Add target-native socket recreation and verifier gates for `SO_ACCEPTCONN`,
      bound address/port, backlog policy, fd flags, and no accepted peers.
- [x] Add positive proof profile `tcp-listener-recreate`.
- [x] Add negative profiles/tests for active accepted connections, pending accept
      queue, in-flight accept, non-loopback bind without policy, unsupported
      socket options, socket fd aliases, socket readiness without Track 3, and
      namespace/credential ambiguity.
- [x] Update support envelope, resource translation docs, refusal inventory,
      proof matrix docs, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] active TCP connections without an explicit broker/transport contract;
- [!] listening sockets with queued accepted connections;
- [!] socket readiness claims not covered by a readiness verifier;
- [!] raw socket/kernel network namespace state without a portable contract.

## Track 2: multiple private anonymous memory ranges with guards

Goal: move beyond the single private anonymous data-range proof while preserving
strict provenance, permissions, and guard-page checks.

First accepted subset:

- multiple private anonymous non-executable writable ranges;
- deterministic target placement or explicit relocation table;
- no source-owned executable/JIT bytes;
- guard pages before/after selected ranges when declared;
- no shared mappings;
- no stale or partial captured bytes;
- pointer relocation only for pointers proven to target-owned accepted ranges.

Tasks:

- [x] Define `private-layout-v2:multi-anonymous-data-ranges` with range ids,
      permissions, captured-byte hashes, target placement, guard pages, and
      relocation constraints.
- [x] Extend memory materialization planning for multiple accepted ranges and
      guard-page verification.
- [x] Add target verifier checks for range contents, permissions, guard faults or
      protections, and relocation ownership.
- [x] Add positive proof profile `private-multi-range-recreate`.
- [x] Add negative profiles/tests for shared mappings, W+X mappings, stale range
      hashes, overlapping ranges, guard mismatch, source pointers into refused
      mappings, and out-of-bounds relocation targets.
- [x] Update memory docs, support envelope, proof matrix docs, refusal inventory,
      and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] executable/JIT/self-modifying code without target-native regeneration;
- [!] shared memory without a target sharing contract;
- [!] arbitrary pointer graphs without exact provenance.

## Track 3: epoll wait graphs without cycles

Goal: graduate a practical epoll interest graph subset that composes with already
accepted descriptors and readiness gates.

First accepted subset:

- one epoll fd watching one or more accepted target-owned fds;
- level-triggered readiness only;
- no epoll-to-epoll cycles;
- no edge-triggered or one-shot events;
- no socket readiness unless Track 1 listener readiness is explicitly modeled;
- target verifier checks interest list, ready events, data payload, and no
  unexpected events.

Tasks:

- [x] Define `epoll-graph-v1:acyclic-level-triggered` with watched fd refs,
      event masks, data payload, readiness expectations, and cycle checks.
- [x] Extend descriptor/resource translation to build acyclic epoll graphs over
      accepted descriptors.
- [x] Add target-native epoll graph recreation and readiness verifier gates.
- [x] Add positive proof profile `epoll-graph-recreate`.
- [x] Add negative profiles/tests for epoll cycles, edge-triggered/one-shot
      events, stale watched fds, socket readiness without policy, unsupported
      event masks, duplicated watched fds, and ambiguous ready-list state.
- [x] Update support envelope, active-syscall/resource docs, proof matrix docs,
      refusal inventory, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] scheduler wake ordering/fairness claims;
- [!] edge-triggered or one-shot readiness;
- [!] epoll cycles or target-ambiguous ready lists.

## Track 4: file-backed private mappings

Goal: support private file-backed data mappings when provenance and permissions
are exact, without copying source executable code or claiming shared semantics.

First accepted subset:

- private, non-executable file-backed mapping;
- target file provenance by path plus digest/build id;
- offset, length, permissions, and copy-on-write dirty-byte overlay are exact;
- no shared mapping semantics;
- no executable target code claims;
- target verifier checks mapped bytes, dirty private bytes, permissions, and file
  identity.

Tasks:

- [x] Define `file-backed-private-mapping-v1` with target file identity, offset,
      length, permissions, dirty page hashes, and refusal reasons.
- [x] Extend mapping materialization and target guest memory restore to recreate
      the accepted mapping natively.
- [x] Add verifier checks for file identity, mapped bytes, private dirty overlay,
      and permissions.
- [x] Add positive proof profile `file-backed-private-mapping-recreate`.
- [x] Add negative profiles/tests for missing file provenance, digest mismatch,
      executable mappings, shared mappings, unsupported permissions, stale dirty
      pages, and source-only paths.
- [x] Update mapping docs, support envelope, proof matrix docs, refusal inventory,
      and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] executable file mappings without target-native regeneration and instruction
  provenance;
- [!] shared mappings without a target sharing contract;
- [!] source-only path identity or missing digest/build id.

## Track 5: deterministic `EINTR` for one active syscall

Goal: graduate one deterministic interrupted-syscall outcome without accepting
ambiguous restart blocks or pending signal delivery.

First accepted subset:

- one active syscall with deterministic `-EINTR` completion;
- no pending signal queue replay;
- no active signal frame or alt-stack;
- exact remaining-time contract when the syscall has a timeout;
- final blocked signal mask verified;
- target continuation returns the exact errno/result expected by the source
  semantic state.

Tasks:

- [x] Define `active-syscall-eintr-v1` with syscall allowlist, interrupted result,
      remaining-time semantics, signal mask, and refusal reasons.
- [x] Extend active-syscall planning to produce a target-native `EINTR` completion
      recipe for the first allowed syscall.
- [x] Add target verifier checks for return value, errno, remaining time, signal
      mask, and no pending delivery.
- [x] Add positive proof profile `active-syscall-eintr-recreate`.
- [x] Add negative profiles/tests for restart blocks, pending signals, active
      signal frames, alt-stacks, unsupported syscalls, ambiguous remaining time,
      and signal-mask-changing waits.
- [x] Update signal/active-syscall docs, support envelope, proof matrix docs,
      refusal inventory, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] ambiguous syscall restart state;
- [!] pending signal queues and active signal frames;
- [!] signal-mask-changing `ppoll`/wait semantics until their own ordering
  contract exists.

## Track 6: runtime adapter consumers stay non-supporting

Goal: prove future runtime tracks can consume the adapter boundary without
claiming runtime support prematurely.

Tasks:

- [x] Add sample Node/Python/Go/JVM planning fixtures that map hypothetical
      runtime state to app-neutral capabilities and refusal codes without
      claiming support.
- [x] Add adapter validation tests that reject a runtime fixture if it lists a
      required capability not present in the support envelope or Goal 8 graduated
      capabilities.
- [x] Add docs showing how each Goal 8 capability would unblock a future runtime
      state class while opaque native extension/JIT/app-hook cases remain
      refused.
- [x] Ensure no fixture can set `supportClaimed=true` unless a target-native proof
      profile exists for every required capability.

Done when runtime-specific planning can reference Goal 8 capabilities without
creating a runtime-specific success path.

## Cross-goal completion criteria

Goal 8 is complete only when:

- [x] at least one app-neutral real-app blocker is graduated with the full support
      checklist;
- [x] no runtime/app family is marked supported by documentation alone;
- [x] every new positive profile has nearby runnable refusal profiles;
- [x] every new/changed profile has `capabilities` or `refusesCapabilities` and
      passes schema validation;
- [x] proof matrices reproduce the new counts and stable JSON output;
- [x] target-native provenance for new remote proofs includes guest arch,
      kernel/rootfs/VMM/helper hashes, continuation hash, descriptor hash, tool
      versions, and remote host details;
- [x] Goal 3/4/6/7 graduated profiles still pass remotely;
- [x] the original positive matrix still passes remotely;
- [x] the full refusal matrix still passes;
- [x] the full Goal 8 foundation matrix passes remotely;
- [x] full smoke tests pass if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
      changed;
- [x] no new path uses source-ISA emulation, sidecar runtime success, app hooks,
      or source text replay;
- [x] validation timings are recorded for every completed task.
