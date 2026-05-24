# Goal 6: support graduation from proven refusal boundaries

`goal-5.md` proved the next refusal frontier. This file is the implementation
ledger for turning that frontier into real target-native support. Unlike
`goal-5.md`, this goal cannot be completed by documenting refusals alone: each
track below must graduate at least one narrow success subset, keep unsafe
neighbors refused, and prove the accepted subset with remote arm64->amd64 target
execution.

The first implementation should be the smallest support claim that composes with
already-graduated descriptor recipes. The recommended order is:

1. readiness-aware wait over one accepted descriptor;
2. regular-file duplicate fd aliases;
3. target-owned auxv/process-context expansion;
4. one broader private memory/layout shape;
5. signal-mask or deterministic `EINTR` support.

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

Permanent refusal invariants still apply. Raw cross-ISA `.vmstate` replay,
source vDSO/vvar copying, source-ISA emulation, sidecar success paths, app hooks,
source text replay, and ambiguous descriptor or mapping provenance remain
refused.

## Automation rules

- Base each implementation task on `portable-snapshots`.
- Use one issue, one branch, and one PR per support subset.
- Start from one proven refusal profile/code from `goal-5.md`.
- Do not mark a track complete with refusal-only work.
- Prefer one narrow accepted subset over a broad model with hidden assumptions.
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

## Support graduation 1: readiness-aware `poll`/`ppoll`

Start from proven refusals:

- `readiness-wait-refusal`: `kernel-state-unsupported`;
- `readiness-scheduler-refusal`: `kernel-state-unsupported`;
- `readiness-edge-trigger-refusal`: `kernel-state-unsupported`;
- `readiness-signal-mask-refusal`: `signal-state-unsupported`;
- `readiness-pollfd-memory-refusal`: `mapping-provenance-ambiguous`;
- `socket-readiness-refusal`: `target-socket-syscall-state-unsupported`.

First accepted subset:

- `readiness-wait-v1:eventfd-pollin`;
- syscall: `poll` or `ppoll` with no signal-mask change;
- watched fds: exactly one target-owned `eventfd-counter-v1` descriptor;
- events: level-triggered `POLLIN` only;
- readiness source: non-semaphore eventfd counter is nonzero after target-native
  descriptor recreation;
- pollfd memory: private, translated, target-owned, bounded to one `struct
pollfd`;
- timeout: zero or deterministic no-wait only for the first proof;
- target verifier: final `revents` contains `POLLIN` and no unexpected bits;
- completion: `migrationCompleted=true` only after descriptor, resource,
  active-syscall, memory, signal, and resume-path gates pass.

Follow-up accepted subset after the first is stable:

- `readiness-wait-v1:pipe-not-readable-timeout` over `pipe-pair-v1`; or
- `readiness-wait-v1:timerfd-readable` only if remaining-time and expiration
  state are exact.

Tasks:

- [ ] Define the `readiness-wait-v1` portable model with syscall kind, watched fd
      recipe refs, event mask, expected readiness, timeout semantics, and pollfd
      memory ownership.
- [ ] Add target-native loader/trampoline support to install the accepted watched
      descriptor before the wait and run/verify the wait natively.
- [ ] Add target verifier checks for `revents`, unexpected bits, poll return
      value, and descriptor/resource gates before completion.
- [ ] Add positive proof profile `eventfd-readiness-pollin-recreate`.
- [ ] Add negative profiles/tests for unsupported watched fds, socket readiness,
      nested epoll cycles, stale readiness, fd-set overflow, shared pollfd
      memory, unsupported event masks, non-null signal masks, and ambiguous
      timeout or wake ordering.
- [ ] Preserve existing timeout-driven profiles and all Goal 3/4 graduated
      profiles.
- [ ] Update active-syscall docs, resource translation docs, proof-profile docs,
      refusal inventory, and validation timings.
- [ ] Run focused Vitest, remote proof for the new profile, full smoke, and fallow
      audit.

Refusal boundaries that remain:

- [!] scheduler wake ordering/fairness claims;
- [!] edge-triggered or one-shot readiness;
- [!] socket readiness without a broker/transport contract;
- [!] signal-mask-changing waits until signal-mask support graduates;
- [!] shared, stale, oversized, or non-target-owned pollfd/fd-set memory.

## Support graduation 2: duplicate fd aliases for regular files

Start from proven refusals:

- `duplicate-fd-alias-refusal`: `target-fd-table-duplicate`;
- `fd-alias-lock-refusal`: `target-fd-table-duplicate`;
- `fd-alias-socket-refusal`: `target-socket-syscall-state-unsupported`;
- `fd-alias-epoll-cycle-refusal`: `target-epoll-syscall-state-unsupported`;
- `descriptor-provenance-refusal`: `mapping-provenance-ambiguous`.

First accepted subset:

- `shared-open-file-description-v1:regular-file`;
- exactly two fds that alias one regular-file open-file description;
- shared state: open-file offset and status flags;
- per-fd state: descriptor number and close-on-exec flag;
- no locks, leases, async notification, signal ownership, or mmap coupling;
- target recipe: open the regular file once, recreate aliases with `dup2`/`dup3`,
  set per-fd flags, and verify shared offset/status flags;
- target verifier: reads or seeks through one fd change the offset observed by
  the other fd.

Tasks:

- [ ] Define `shared-open-file-description-v1` with alias group id, member fds,
      shared offset, shared status flags, per-fd flags, resource provenance, and
      verifier checks.
- [ ] Extend resource translation to group duplicate regular-file fds instead of
      refusing them when the exact subset is met.
- [ ] Add target-native alias recreation via one open plus `dup2`/`dup3` and fd
      flag restoration.
- [ ] Add positive proof profile `regular-file-duplicate-fd-recreate`.
- [ ] Add negative tests/profiles for mismatched offsets, unsupported status
      flags, missing members, closed peers, locks/leases, async notification,
      socket aliases, epoll cycles, pipe/eventfd/timerfd aliases, and ambiguous
      provenance.
- [ ] Update descriptor/resource docs, target loader docs, proof-profile docs,
      refusal inventory, and validation timings.
- [ ] Run focused Vitest, remote proof for the new profile, full smoke, and fallow
      audit.

Refusal boundaries that remain:

- [!] aliases with file locks, leases, async notification, or unknown ownership;
- [!] socket aliases without a broker/transport contract;
- [!] epoll cycles or ambiguous descriptor graphs;
- [!] aliases that affect readiness without Support graduation 1-compatible
  verifier coverage;
- [!] pipe/eventfd/timerfd aliases until exact shared semantics are modeled.

## Support graduation 3: target-owned auxv/process context

Start from proven refusals:

- `auxv-source-pointer-refusal`: `target-process-context-unsupported`;
- `at-random-source-refusal`: `target-process-context-unsupported`;
- `at-execfn-identity-refusal`: `target-process-context-unsupported`;
- `target-libc-global-refusal`: `target-process-context-unsupported`;
- `argv-env-pointer-refusal`: `target-process-context-unsupported`;
- `source-vdso-vvar-refusal`: `vdso-policy-unsupported`.

First accepted subset:

- `target-auxv-v1:at-random`;
- target restore path generates target-owned random bytes;
- target auxv points to target-owned memory, never source-owned bytes;
- target verifier checks auxv pointer ownership, size, alignment, and digest or
  marker semantics without exposing source randomness;
- no target libc global state is claimed beyond the verified auxv/pointer block.

Follow-up accepted subset after `AT_RANDOM` is stable:

- `target-auxv-v1:at-execfn` with exact target executable identity and path
  provenance.

Tasks:

- [ ] Define `target-auxv-v1` with per-entry key, value class, ownership,
      materialization action, and target verifier expectation.
- [ ] Add target-owned `AT_RANDOM` materialization in the target restore path.
- [ ] Add target verifier coverage for `AT_RANDOM` pointer ownership, size,
      alignment, and non-source provenance.
- [ ] Add positive proof profile `target-auxv-at-random`.
- [ ] Add negative tests/profiles for source-owned auxv pointers, source-owned
      `AT_RANDOM`, unmapped auxv pointers, size overflows, ambiguous `AT_EXECFN`,
      unknown libc globals, and source vDSO/vvar reuse.
- [ ] Add `AT_EXECFN` only after executable identity and path provenance are exact.
- [ ] Update process-context docs, proof-profile docs, refusal inventory, and
      validation timings.
- [ ] Run focused Vitest, remote proof for the new profile, full smoke, and fallow
      audit.

Refusal boundaries that remain:

- [!] copying source vDSO/vvar bytes;
- [!] source-owned auxv pointers into unmapped or source-only memory;
- [!] unknown or mismatched target libc startup/global state;
- [!] ambiguous cwd/env/argv pointer ownership or size overflow;
- [!] source-provided randomness reused as target-owned `AT_RANDOM`.

## Support graduation 4: broader private memory/layout

Start from proven refusals:

- `private-layout-refusal`: `mapping-permission-unsupported`;
- `shared-mapping-refusal`: `mapping-shared-unsupported`;
- `private-source-pointer-refusal`: `mapping-provenance-ambiguous`;
- `stale-private-range-refusal`: `mapping-captured-range-unsupported`;
- `wx-private-mapping-refusal`: `mapping-executable-unsupported`;
- `jit-self-modifying-refusal`: `mapping-executable-unsupported`.

First accepted subset:

- `private-layout-v1:single-anonymous-data-range`;
- one private anonymous read/write non-executable range;
- exact source bounds, target bounds, page alignment, captured hash, and
  zero-fill policy;
- no source-only pointer words unless classified as opaque scalar;
- guard pages either preserved exactly or refused;
- target verifier checks final permissions, content hash, zero-fill bytes, guard
  behavior, and absence of executable mappings.

Tasks:

- [ ] Define `private-layout-v1` with range bounds, alignment, permissions,
      target address policy, captured hash, zero-fill behavior, guard gaps, and
      pointer ownership classes.
- [ ] Extend private-memory materialization for one exact anonymous data range.
- [ ] Add target gates for final permissions, guard pages, zero-fill behavior,
      content hash, and no unexpected executable mappings.
- [ ] Add positive proof profile `private-anonymous-data-range-recreate`.
- [ ] Add negative tests/profiles for shared mappings, executable data, W+X
      mappings, source-only pointers, overlapping ranges, stale hashes, guard
      mismatches, permission mismatches, and unsupported fixed-address conflicts.
- [ ] Add private `mmap` shape only after the first heap/data range proof is
      stable.
- [ ] Update memory materialization docs, proof-profile docs, refusal inventory,
      and validation timings.
- [ ] Run focused Vitest, remote proof for the new profile, full smoke, and fallow
      audit.

Refusal boundaries that remain:

- [!] executable source bytes or ambiguous executable provenance;
- [!] shared mappings without a target sharing contract;
- [!] pointers into source-only mappings, vDSO/vvar, or unsupported resources;
- [!] overlapping or stale private ranges;
- [!] W+X or self-modifying active windows without target-native regeneration.

## Support graduation 5: signal mask and deterministic `EINTR`

Start from proven refusals:

- `signal-mask-restart-refusal`: `signal-state-unsupported`;
- `pending-signal-refusal`: `signal-state-unsupported`;
- `active-signal-frame-refusal`: `signal-state-unsupported`;
- `alt-stack-refusal`: `signal-state-unsupported`;
- `restart-remaining-time-refusal`: `syscall-restart-unsupported`;
- `restart-state-refusal`: `syscall-restart-unsupported`.

First accepted subset:

- `target-signal-mask-v1:blocked-mask-only`;
- blocked signal mask can be applied and verified before target-native
  continuation;
- no pending signals, queued `siginfo`, active signal frame, enabled alt-stack,
  handler delivery, or restart block;
- target verifier checks final blocked mask and confirms no pending/active signal
  state was materialized as success.

Follow-up accepted subset after mask-only support is stable:

- deterministic `EINTR` for one syscall where no restart is claimed and final
  signal mask/result semantics are exact.

Tasks:

- [ ] Define `target-signal-mask-v1` with blocked-mask representation,
      unsupported signals, apply order, and target verifier expectations.
- [ ] Add target-native mask apply/verify support for blocked-mask-only state.
- [ ] Add positive proof profile `signal-mask-blocked-recreate`.
- [ ] Add negative tests/profiles for pending signals, queued siginfo, active
      signal frames, enabled alt-stacks, handler delivery ambiguity,
      signal-mask-changing waits without a verifier, and restart blocks without
      remaining time.
- [ ] Define per-syscall remaining-time contracts before claiming any restart
      support.
- [ ] Add deterministic `EINTR` support only after final result and signal mask
      semantics are exact.
- [ ] Update signal policy docs, active-syscall docs, proof-profile docs, refusal
      inventory, and validation timings.
- [ ] Run focused Vitest, remote proof for the new profile, full smoke, and fallow
      audit.

Refusal boundaries that remain:

- [!] active signal frames or source handler stacks;
- [!] queued pending signals or `siginfo` without a target delivery model;
- [!] alt-stack state without target-native frame materialization;
- [!] restart blocks without exact remaining time and syscall-specific contract;
- [!] signal-mask-changing waits before the target gate verifies the final mask.

## Cross-goal completion criteria

- [ ] Every support graduation track above has at least one new `graduated-support`
      proof profile.
- [ ] Every new accepted subset has a portable state model, target-native restore
      recipe, target verifier, positive proof, nearby negative proofs, docs, and
      validation timings.
- [ ] Every unsafe neighbor remains covered by a runnable refusal proof profile
      with exact refusal code, `migrationCompleted=false`,
      `descriptorGateCompleted=false`, no source text replay, no source-ISA
      emulation, and no sidecar success path.
- [ ] Goal 3/4 graduated profiles keep passing:
      `epoll-recreate`, `signalfd-recreate`, `eventfd-counter-recreate`,
      `timerfd-descriptor-recreate`, and `pipe-pair-recreate`.
- [ ] The original positive proof matrix from `goal.md` keeps passing.
- [ ] Full smoke tests have run with timings for every task that touches
      VM/VMM/rootfs/assets/CLI/snapshot/restore behavior.
- [ ] No new success path uses source-ISA emulation, sidecar runtime, app hooks,
      or source text replay.
