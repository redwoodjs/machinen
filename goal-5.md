# Goals 9-13: refusal-boundary graduation wave

`goal-4.md` closed the Goals 4-8 ledger by proving the current refusal
boundaries. This file combines the next wave into one roadmap so work stays
ordered while each implementation task remains small, reviewed, and merged
sequentially.

The theme for this wave is: start from a proven refusal, graduate one narrow
native-transparent subset, and keep every unsafe neighbor fail-closed.

## Baseline carried forward

The accepted success path remains unchanged:

- arm64 process state -> portable machine snapshot -> amd64 VM restore;
- target-native completion only;
- no Node/Bun sidecars;
- no source-ISA emulation as success;
- no app hooks;
- no source text reused as target code;
- unsafe or ambiguous state fails closed with precise refusal codes;
- `migrationCompleted=true` only after target-native completion and all relevant
  target gates pass.

Permanent refusal invariants still apply unless a future goal explicitly changes
one with a complete portable state model, target-native restore recipe, target
verifier, positive proof, nearby negative proofs, docs, and validation timings.
Raw cross-ISA `.vmstate` replay, source vDSO/vvar copying, source-ISA emulation,
sidecar success paths, app hooks, source text replay, and ambiguous descriptor or
mapping provenance remain refused.

## Automation rules

- Base each implementation task on `portable-snapshots`.
- Use one issue, one branch, and one PR per task.
- Work on one state family or one proof profile at a time.
- Prefer narrower accepted subsets over broad models with hidden assumptions.
- Start from an existing refusal profile/code, or add a stable refusal before
  adding support.
- A support claim requires:
  - portable state model;
  - target-native restore recipe;
  - target gate or verifier evidence;
  - positive proof automation;
  - nearby negative tests/profiles;
  - docs and validation timings.
- Keep unsupported variants on exact refusal codes with `migrationCompleted=false`
  and `descriptorGateCompleted=false` when descriptor validation cannot complete.
- Run full smoke tests whenever VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
  is touched.

## Status legend

- `[ ]` todo.
- `[x]` complete and merged.
- `[!]` permanent or intentionally refused invariant.
- `[~]` partial implementation exists but is not yet a supported success claim.

## Recommended execution order

The numbered goals below keep their subject numbering, but the safest execution
order is:

1. Goal 9 readiness-aware waits.
2. Goal 13 duplicate/shared open-file-description aliases.
3. Goal 10 target auxv/process context.
4. Goal 11 broader private memory/layout materialization.
5. Goal 12 signal mask and restart semantics.

Readiness and fd aliasing build directly on Goal 4 descriptor recipes. Auxv,
memory layout, and signal/restart semantics depend on broader process-model
invariants and should come after those descriptor/wait foundations are firmer.

## Goal 9: readiness-aware wait graduation

Start from the proven refusal profile:

- profile: `readiness-wait-refusal`;
- refusal code: `kernel-state-unsupported`.

Goal 9 graduates only level-triggered readiness that is derived from
already-accepted, target-owned fd/resource recipes. It must not claim general
scheduler wake ordering, fairness, edge-triggering, one-shot behavior, or socket
readiness.

Accepted subset candidates:

- `poll`/`ppoll` over exactly one watched fd with an accepted target recipe;
- later `poll`/`ppoll` over a bounded small vector whose memory is private,
  translated, and target-owned;
- level-triggered `POLLIN`/`POLLOUT` readiness only;
- deterministic timeout or no-timeout behavior with explicit remaining time;
- no signal-mask changes;
- watched descriptors limited to accepted recipes such as `eventfd-counter-v1`,
  `pipe-pair-v1`, `timerfd-descriptor-v1`, regular file recipes, and the already
  graduated epoll/signalfd descriptor subsets when their readiness is exact.

Tasks:

- [ ] Define `readiness-wait-v1` with syscall kind, watched fd table, poll events,
      expected level-triggered readiness, timeout/remaining-time model, and
      pollfd/fd-set memory ownership.
- [ ] Add target-native restore/trampoline support that installs accepted watched
      descriptors before the wait and verifies final `revents` or fd-set bits
      before `migrationCompleted=true`.
- [ ] Add a first positive proof profile for one exact readable or not-readable
      descriptor, preferably `eventfd-counter-v1` readable or `pipe-pair-v1`
      not-readable timeout.
- [ ] Add a second positive proof only after the first is stable, covering a
      different accepted fd family.
- [ ] Add negative profiles for unsupported watched fds, socket readiness, nested
      epoll cycles, stale readiness, fd-set overflow, shared/writable pollfd
      memory, unsupported events, non-null signal masks, and ambiguous timeouts.
- [ ] Extend active-syscall translation only after descriptor/resource gates prove
      every watched fd and the target verifier proves readiness outcomes.
- [ ] Keep existing timeout-driven wait proofs passing as baseline profiles.
- [ ] Update docs, refusal inventory, proof-profile docs, and validation timings.

Refusal boundaries that remain unless explicitly modeled:

- [!] scheduler wake ordering or fairness claims;
- [!] edge-triggered or one-shot readiness semantics;
- [!] signal-mask-changing waits before Goal 12 support;
- [!] socket readiness without a broker/transport contract;
- [!] unsupported watched descriptors, nested epoll cycles, or ambiguous aliasing;
- [!] pollfd/fd-set memory that is shared, stale, oversized, or not target-owned.

## Goal 10: target auxv and process-context expansion

Start from the proven refusal profile:

- profile: `auxv-source-pointer-refusal`;
- refusal code: `target-process-context-unsupported`.

Goal 10 expands process-context materialization only where values are
explicitly target-owned, target-verified, or refused. Source vDSO/vvar bytes and
source-owned auxv pointers remain refused.

Accepted subset candidates:

- `target-auxv-v1` entries with per-entry provenance and ownership;
- target-owned `AT_RANDOM` bytes generated by the target restore path and wired
  into the target auxv/pointer block;
- target-owned `AT_EXECFN` when executable identity and path provenance are
  exact;
- bounded argv/env/cwd updates with size limits and target pointer validation;
- selected scalar auxv entries that are copied only when target ABI compatibility
  is proven or re-synthesized by the target;
- target libc startup/global state only when tied to a known target libc build and
  verified before completion.

Tasks:

- [ ] Define `target-auxv-v1` with per-entry key, value class, ownership,
      materialization action, and target verifier expectation.
- [ ] Add target-owned `AT_RANDOM` materialization and verifier coverage, or keep
      it explicitly refused with a stable negative proof.
- [ ] Add target-owned `AT_EXECFN` materialization and verifier coverage, or keep
      it explicitly refused with a stable negative proof.
- [ ] Inventory scalar auxv entries and mark each as target-generated,
      target-verified, copied-with-proof, or refused.
- [ ] Add target libc build identity assumptions and refusal tests for unknown or
      mismatched libc/global startup state.
- [ ] Add positive process-context proof profiles only for exact target-owned
      entries.
- [ ] Add negative profiles for source-owned auxv pointers, unmapped auxv
      pointers, size overflows, ambiguous executable identity, unknown libc
      globals, and source vDSO/vvar reuse.
- [ ] Update target process-context docs, proof-profile docs, refusal inventory,
      and validation timings.

Refusal boundaries that remain unless explicitly modeled:

- [!] copying source vDSO/vvar bytes: `vdso-policy-unsupported`;
- [!] source-owned auxv pointers into unmapped or source-only memory;
- [!] unknown or mismatched target libc startup/global state;
- [!] ambiguous cwd/env/argv pointer ownership or size overflows;
- [!] source-provided randomness reused as target-owned `AT_RANDOM`.

## Goal 11: broader private memory and layout materialization

Start from the proven refusal profile:

- profile: `private-layout-refusal`;
- refusal code: `mapping-permission-unsupported`.

Goal 11 widens private target memory coverage only when provenance, permissions,
guard behavior, relocation, and pointer ownership are exact. It must not turn raw
source memory copying into executable or kernel-owned state migration.

Accepted subset candidates:

- one bounded private anonymous heap/brk range with exact lower/upper bounds,
  permissions, zero-fill policy, and guard policy;
- one private `mmap` range with deterministic target address or explicit
  relocation metadata;
- read/write private data pages whose pointer-like words are internal,
  translated, or intentionally opaque scalars;
- target-owned TLS/TCB backing that remains verified by existing gates;
- layout gaps and guard pages that are intentionally preserved or refused.

Tasks:

- [ ] Define `private-layout-v1` with range bounds, alignment, permissions,
      guard gaps, target address policy, captured hash, and zero-fill behavior.
- [ ] Define pointer ownership classes for private data: target pointer,
      translated source pointer, internal relocated pointer, opaque scalar, and
      unsupported source-only pointer.
- [ ] Add target gates for final permissions, guard pages, zero-fill behavior,
      relocated pointer checks, and no unexpected executable mappings.
- [ ] Add a positive proof for one exact heap/brk shape.
- [ ] Add a positive proof for one exact private-`mmap` shape only after the
      heap/brk proof is stable.
- [ ] Add negative profiles for shared mappings, executable data, W+X mappings,
      source-only pointers, overlapping ranges, stale hashes, guard mismatches,
      permission mismatches, and unsupported fixed-address conflicts.
- [ ] Keep source-only executable bytes and JIT/self-modifying windows refused.
- [ ] Update memory materialization docs, proof-profile docs, refusal inventory,
      and validation timings.

Refusal boundaries that remain unless explicitly modeled:

- [!] executable source bytes or ambiguous executable provenance:
  `mapping-executable-unsupported` / `mapping-provenance-ambiguous`;
- [!] shared mappings without a target sharing contract;
- [!] pointers into source-only mappings, vDSO/vvar, or unsupported resources;
- [!] overlapping or stale private ranges;
- [!] W+X or self-modifying active windows without target-native regeneration.

## Goal 12: signal mask and deterministic restart/EINTR semantics

Start from the proven refusal profiles:

- profile: `signal-mask-restart-refusal`;
- refusal code: `signal-state-unsupported`;
- profile: `restart-state-refusal`;
- refusal code: `syscall-restart-unsupported`.

Goal 12 may graduate only narrow signal/restart subsets where target behavior is
identical and verifiable. Pending delivery, active handler frames, and ambiguous
restart blocks remain refused.

Accepted subset candidates:

- blocked signal masks that can be applied and verified before target-native
  continuation;
- empty pending queues with signalfd descriptors already covered by Goal 3;
- deterministic `EINTR` outcomes for one syscall where no restart is claimed;
- restart of one syscall only when remaining time, signal mask, restart block,
  and result semantics are exact;
- signal delivery state with no active handler frame unless a future model
  materializes the target handler frame natively.

Tasks:

- [ ] Define `target-signal-mask-v1` with blocked-mask representation,
      unsupported signals, apply order, and target verifier expectations.
- [ ] Add a positive mask-only proof that applies/verifies a blocked signal mask
      with no pending queue and no active handler frame.
- [ ] Define per-syscall remaining-time contracts for sleep, `poll`/`ppoll`,
      timerfd-backed waits, and readiness-aware waits before claiming restart
      support.
- [ ] Add a deterministic `EINTR` proof only when the target result and final
      signal mask are exact.
- [ ] Add a restart proof only after one syscall-specific remaining-time contract
      is exact and negative variants exist.
- [ ] Add negative profiles for pending signals, queued siginfo, active signal
      frames, enabled alt-stacks, handler delivery ambiguity, signal-mask-changing
      waits without a verifier, and restart blocks without remaining time.
- [ ] Preserve `migrationCompleted=false` for every signal/restart refusal.
- [ ] Update signal policy docs, active-syscall docs, proof-profile docs, refusal
      inventory, and validation timings.

Refusal boundaries that remain unless explicitly modeled:

- [!] active signal frames or source handler stacks;
- [!] queued pending signals or siginfo without target delivery model;
- [!] alt-stack state without target-native frame materialization;
- [!] restart blocks without exact remaining time and syscall-specific contract;
- [!] signal-mask-changing waits before the target gate verifies the final mask.

## Goal 13: duplicate fd aliases and shared open-file-description semantics

Start from the existing refusal boundary:

- refusal code: `target-fd-table-duplicate`.

Goal 13 graduates duplicate fd aliases only when they can be represented as one
target open-file description with exact shared offset/status-flag semantics and
per-fd descriptor flags. This should follow or coordinate with Goal 9 because
aliasing affects readiness and wait sets.

Accepted subset candidates:

- regular-file duplicate fd group with shared open-file offset and status flags;
- per-fd close-on-exec flags restored independently;
- target recreation via `dup2`, `dup3`, or `fcntl(F_DUPFD_CLOEXEC)` with verifier
  checks for shared offset and flags;
- optional later pipe/eventfd aliases only when buffer/counter/readiness semantics
  remain exact;
- no locks, leases, async notification, epoll cycles, or unknown peer ownership.

Tasks:

- [ ] Define `shared-open-file-description-v1` with alias group id, member fds,
      shared offset, shared status flags, per-fd flags, resource provenance, and
      verifier checks.
- [ ] Add target-native recreation for one regular-file duplicate group and prove
      shared offset/status flags before descriptor gate completion.
- [ ] Add a positive proof profile for a regular-file duplicate group whose
      target-native reads/writes prove shared offset semantics.
- [ ] Add negative profiles for mismatched offsets, unsupported status flags,
      missing members, closed peers, ambiguous provenance, locks/leases, async
      notification, epoll cycles, socket aliases, and readiness ambiguity.
- [ ] Decide whether pipe/eventfd/timerfd aliases can graduate; if not, keep them
      explicitly refused with stable proof profiles.
- [ ] Update descriptor/resource translation docs, target loader docs,
      proof-profile docs, refusal inventory, and validation timings.

Refusal boundaries that remain unless explicitly modeled:

- [!] duplicate fds without exact shared open-file-description semantics:
  `target-fd-table-duplicate`;
- [!] aliases with file locks, leases, async notification, or unknown ownership;
- [!] aliases that affect readiness without Goal 9-compatible verifier coverage;
- [!] socket aliases without a broker/transport contract;
- [!] epoll cycles or descriptor graphs whose ordering/provenance is ambiguous.

## Cross-goal completion criteria

- [ ] Each goal graduates at least one narrow support subset or explicitly records
      why the family remains refused.
- [ ] Every graduated subset has docs, unit tests, positive proof automation,
      nearby negative tests/profiles, target gates, and stable refusal behavior
      outside the subset.
- [ ] Every refusal boundary remains runnable as a proof profile with the exact
      refusal code, `migrationCompleted=false`, no sidecar success path, no
      source-ISA emulation, and no source text replay.
- [ ] The Goal 3 and Goal 4 graduated profiles keep passing:
      `epoll-recreate`, `signalfd-recreate`, `eventfd-counter-recreate`,
      `timerfd-descriptor-recreate`, and `pipe-pair-recreate`.
- [ ] The original positive proof matrix from `goal.md` keeps passing.
- [ ] Full validation has run with timings whenever VM/assets/restore behavior is
      touched.
- [ ] No new success path uses source-ISA emulation, sidecar runtime, app hooks,
      or source text replay.
