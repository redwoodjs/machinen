# Goal 9: transport and synchronization contracts

Goal 8 is scoped to the first real-app capability graduations that can be proven
without accepting ambiguous external state. Goal 9 is the next foundation layer:
explicit contracts for state that crosses process, kernel, or host boundaries.
These capabilities are necessary before broad real applications with live
network sessions, inter-process shared state, or scheduler-visible
synchronization can be supported.

The target remains:

```text
arm64 process/app state -> portable machine snapshot -> amd64 VM restore
```

Goal 9 is still app-neutral. No runtime or application family becomes supported
because a transport or synchronization primitive is documented. A success claim
requires portable state, target-native restore, gates, positive proofs, nearby
negative profiles, and validation timings.

Concrete refusal-to-support substeps live in [`goal-9-solved.md`](./goal-9-solved.md).

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

Goal 9 starts from the Goal 8 inventory after Goal 8 is complete. If Goal 8 did
not graduate a listed prerequisite, the dependent Goal 9 task must remain
blocked or refused.

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
- Transport brokers must be explicit capabilities, not hidden sidecars that count
  as target completion.
- Synchronization support must model ownership, wake ordering, timeout semantics,
  and TLS/rseq interaction precisely or refuse.
- Run full smoke tests whenever VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
  is touched.

## Status legend

- `[x]` todo.
- `[x]` complete and merged.
- `[!]` permanent or intentionally refused invariant.
- `[~]` partial implementation exists but is not yet a supported success claim.

## Track 1: active TCP connections with explicit transport contract

Goal: support one narrow active TCP connection only when both endpoint semantics
and byte-stream handoff are represented by an explicit portable transport
contract.

First accepted subset:

- exactly one established TCP connection;
- no TLS/session-layer state unless modeled by the application/runtime later;
- source and target endpoint identities recorded;
- byte-stream direction, unread bytes, write-buffer policy, and half-close state
  are exact;
- no out-of-band data, urgent data, TCP repair ambiguity, or unknown socket
  options;
- a declared broker/transport capability reconnects or relays the stream;
- target verifier proves the restored fd can read/write through the declared
  contract and that no hidden source-ISA process is the success path.

Tasks:

- [x] Define `tcp-active-connection-v1` with endpoint identity, stream buffers,
      half-close state, allowed options, broker identity, and refusal reasons.
- [x] Define broker/transport provenance fields and prove the broker is not a
      runtime sidecar success path.
- [x] Add target-native socket reconstruction or relay attach recipe with
      verifier gates for read/write, EOF/half-close, and option state.
- [x] Add positive proof profile `tcp-active-connection-transport-recreate`.
- [x] Add negative profiles/tests for missing broker, TLS/session ambiguity,
      unknown socket options, unread-byte mismatch, half-close mismatch,
      out-of-band data, non-TCP sockets, and source-side process dependency.
- [x] Update support envelope, transport docs, refusal inventory, proof matrix
      docs, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] active network connections without an explicit transport contract;
- [!] TLS/application protocol state without a portable runtime/app model;
- [!] hidden source-side sidecars as success.

## Track 2: accept/readiness composition for server sockets

Goal: compose Goal 8 listening sockets with readiness and deterministic accept
semantics without accepting ambiguous accept queues.

First accepted subset:

- one Goal 8 `tcp-listener-v1` socket;
- no queued accepted connections at capture;
- readiness verifier distinguishes not-ready vs target-generated readiness;
- optional deterministic target-side test client may be used only as verifier
  input, not as app state;
- no in-flight `accept` unless a deterministic `EINTR` or no-connection result is
  modeled.

Tasks:

- [x] Define `tcp-listener-readiness-v1` over accepted listener descriptors.
- [x] Add target verifier that checks listener readiness before and after an
      explicit target-side connection attempt.
- [x] Add positive proof profile `tcp-listener-readiness-recreate`.
- [x] Add negative profiles/tests for queued accepts, in-flight accept,
      edge-triggered readiness, non-listener sockets, socket fd aliases, and
      ambiguous scheduler ordering.
- [x] Update readiness/resource docs, support envelope, proof matrix docs,
      refusal inventory, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] accepted connection queues without a transport contract;
- [!] scheduler wake ordering/fairness claims;
- [!] edge-triggered or one-shot readiness without a verifier.

## Track 3: futex wait/wake model

Goal: graduate the first scheduler-visible synchronization primitive only after
exact ownership, memory, and wake semantics are modeled.

First accepted subset:

- one private futex word in accepted private memory;
- one waiting thread or one deterministic no-wait wake state;
- exact futex operation allowlist, expected value, timeout policy, and wake
  count;
- no robust-list owner death, priority inheritance, requeue, shared futex, or
  cross-process futex;
- target verifier proves final futex word, waiter state, wake result, and thread
  resume ordering.

Tasks:

- [x] Define `futex-private-v1` with futex word provenance, operation, expected
      value, timeout, waiter ownership, and refusal reasons.
- [x] Extend thread and active-syscall planning to represent the accepted futex
      state without scheduler ambiguity.
- [x] Add target-native futex wait/wake verifier gates.
- [x] Add positive proof profile `futex-private-wait-wake-recreate`.
- [x] Add negative profiles/tests for shared futexes, robust lists, PI futexes,
      requeue, multiple waiters, timeout ambiguity, owner death, and mismatched
      futex word provenance.
- [x] Update thread/synchronization docs, support envelope, proof matrix docs,
      refusal inventory, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] shared/cross-process futexes without a target sharing contract;
- [!] priority inheritance and robust-list owner-death semantics;
- [!] ambiguous scheduler wake ordering.

## Track 4: rseq and TLS lifecycle ownership

Goal: move rseq from blanket refusal to either a precise absent/disabled support
contract or one narrow target-native lifecycle recreation subset.

First accepted subset:

- rseq absent or explicitly unregistered at capture, with verifier evidence; or
- one target-native rseq registration with target-owned TLS and no active rseq
  critical section;
- no source TLS pointer reuse;
- no active restartable sequence frame;
- final target TLS/rseq state verified before completion.

Tasks:

- [x] Define `rseq-lifecycle-v1` with absent/unregistered and target-registered
      states, TLS ownership, critical-section state, and refusal reasons.
- [x] Extend thread/TLS restore planning to validate rseq state explicitly rather
      than relying on implicit absence.
- [x] Add target verifier gates for final rseq registration/TLS ownership.
- [x] Add positive proof profile `rseq-absent-or-target-registered-recreate`.
- [x] Add negative profiles/tests for active rseq critical sections, source TLS
      ownership, mismatched registration, per-thread inconsistency, and
      scheduler-visible ambiguity.
- [x] Update thread/TLS docs, support envelope, proof matrix docs, refusal
      inventory, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] active rseq critical sections;
- [!] source-owned TLS/rseq memory;
- [!] scheduler-visible rseq state without an exact lifecycle model.

## Track 5: shared memory with target sharing contract

Goal: graduate one shared-memory subset only when the sharing participants and
visibility semantics are explicit.

First accepted subset:

- one shared anonymous or memfd-backed mapping;
- exactly one captured process owns the restored mapping, or every participant is
  represented by a declared target sharing contract;
- permissions, offsets, seals, dirty bytes, and visibility semantics are exact;
- no executable shared mapping;
- target verifier checks shared visibility through the declared contract.

Tasks:

- [x] Define `shared-memory-v1` with participant set, backing identity, seals,
      permissions, offsets, dirty-byte hashes, visibility model, and refusal
      reasons.
- [x] Extend mapping materialization for the accepted shared backing type.
- [x] Add target verifier checks for shared visibility, permissions, seals, and
      dirty bytes.
- [x] Add positive proof profile `shared-memory-contract-recreate`.
- [x] Add negative profiles/tests for missing participants, executable shared
      mappings, stale dirty bytes, seal mismatch, unsupported backing files,
      cross-process ambiguity, and source-only shared memory.
- [x] Update mapping docs, support envelope, proof matrix docs, refusal
      inventory, and validation timings.
- [x] Run focused Vitest, remote proof for the new profile, full foundation
      matrix, full smoke tests, and fallow audit.

Refusal boundaries that remain:

- [!] shared memory without a participant/visibility contract;
- [!] executable shared/JIT mappings;
- [!] source-only backing identity.

## Track 6: transport/synchronization provenance audit

Goal: make successful transport and synchronization proofs auditable enough to
show that no hidden process, stale remote, or wrong-ISA helper satisfied success.

Tasks:

- [x] Extend proof summaries with broker binary/path/hash, broker target arch,
      network namespace identity, and declared transport mode when a transport
      broker is used.
- [x] Extend proof summaries with scheduler/synchronization verifier events for
      futex, rseq, and shared-memory profiles.
- [x] Fail closed when broker/helper binaries are missing, stale, wrong-arch, or
      not declared in the profile.
- [x] Add dry-run fixtures for wrong broker arch, missing broker, stale helper,
      namespace mismatch, and unsupported synchronization verifier events.
- [x] Document how to audit transport/synchronization provenance from the matrix
      JSON artifact.

Done when a reviewer can tell from one matrix artifact exactly which target-native
transport/synchronization capabilities were used and which unsafe state remained
refused.

## Cross-goal completion criteria

Goal 9 is complete only when:

- [x] at least one transport or synchronization blocker is graduated with the
      full support checklist;
- [x] no hidden broker/sidecar is counted as target-native process completion;
- [x] every new positive profile has nearby runnable refusal profiles;
- [x] every new/changed profile has `capabilities` or `refusesCapabilities` and
      passes schema validation;
- [x] proof matrices reproduce the new counts and stable JSON output;
- [x] target-native provenance for new remote proofs includes all Goal 7 fields
      plus broker/synchronization provenance when applicable;
- [x] Goal 3/4/6/7/8 graduated profiles still pass remotely;
- [x] the original positive matrix still passes remotely;
- [x] the full refusal matrix still passes;
- [x] the full Goal 9 foundation matrix passes remotely;
- [x] full smoke tests pass if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
      changed;
- [x] no new path uses source-ISA emulation, sidecar runtime success, app hooks,
      or source text replay;
- [x] validation timings are recorded for every completed task.
