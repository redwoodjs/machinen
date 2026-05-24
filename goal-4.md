# Goals 4-8: broaden native-transparent process coverage

Goal 3 closed the first refusal-graduation wave: epoll interest-list and
empty-queue signalfd descriptors have exact target-native models, while sockets,
JIT/self-modifying code, and futex/rseq/scheduler kernel state remain explicit
refusal boundaries.

This file keeps Goals 4 through 8 in one ledger so the next frontier stays
ordered. The work should broaden the class of real Linux process states accepted
by the target-guest loader without weakening the native-transparent contract.

## Baseline carried forward

The accepted success path remains:

- arm64 process state -> portable machine snapshot -> amd64 VM restore;
- target-native completion only;
- no Node/Bun sidecars;
- no source-ISA emulation as success;
- no app hooks;
- no source text reused as target code;
- unsafe or ambiguous state fails closed with precise refusal codes;
- `migrationCompleted=true` only after target-native completion and all relevant
  target gates pass.

Permanent refusal invariants from `goal-3.md` still apply unless a future project
goal explicitly changes them. In particular, raw cross-ISA `.vmstate` replay,
source vDSO/vvar copying, source-ISA emulation, sidecar success paths, app hooks,
source text replay, and ambiguous descriptor provenance remain refused.

## Automation rules

- Base each implementation task on `portable-snapshots`.
- Use one issue, one branch, and one PR per task.
- Work on one state family or one proof profile at a time.
- Prefer narrower accepted subsets over broad models with hidden assumptions.
- Start from an existing refusal or add a stable refusal before adding support.
- A support claim requires:
  - a portable state model;
  - target-native restore recipe;
  - target gate or verifier evidence;
  - positive proof automation;
  - nearby negative tests/profiles;
  - docs and validation timings.
- Keep unsupported variants on exact refusal codes with `migrationCompleted=false`.
- Run full smoke tests when VM/VMM/rootfs/assets/CLI/snapshot/restore behavior is
  touched.

## Status legend

- `[ ]` todo.
- `[x]` complete and merged.
- `[!]` permanent or intentionally refused invariant.
- `[~]` partial implementation exists but is not yet a supported success claim.

## Goal 4: broaden fd/resource recipes

Goal 4 should add more exact fd/resource recipes before tackling general
readiness or restart semantics. The safe path is descriptor recreation where the
kernel-visible state is bounded, observable, and target-owned after restore.

Accepted subset candidates:

- non-semaphore `eventfd` descriptors with an exact counter value;
- timerfd descriptors that are disarmed or future one-shot timers with explicit
  clock, flags, absolute/relative mode, remaining time, and overrun policy;
- pipe descriptor pairs with modeled empty-buffer state, peer ownership, EOF
  behavior, and close-on-exec flags;
- duplicate fd aliases only if they can be represented as one target open-file
  description with exact shared offset/flags semantics;
- fd flags and access modes that can be restored or verified before descriptor
  gate completion.

Tasks:

- [x] Define `eventfd-counter-v1` for non-semaphore eventfds with exact nonzero
      counter recreation, overflow bounds, close-on-exec handling, and refusal of
      semaphore mode or unknown waiters. Issue/PR: #775 / #776.
- [x] Add target-native eventfd recreation, verifier reads/writes, positive proof
      profile, and negative profiles for semaphore mode, overflow, pending
      waiters, and unsupported flags. Issue/PR: #775 / #776.
- [x] Define `timerfd-descriptor-v1` for disarmed and future one-shot timerfds,
      including clock source, absolute/relative mode, remaining time, interval,
      overrun, and cancellation semantics. Issue/PR: #777 / #778.
- [x] Add target-native timerfd recreation and proof profiles for the accepted
      timerfd subset; keep expired, interval, ambiguous clock, and unmodeled
      overrun state refused. Issue/PR: #777 / #778.
- [x] Define pipe descriptor-pair provenance for empty-buffer pipes with known
      read/write ends, peer lifetime, EOF behavior, and fd flags. Issue/PR: #779
      / #780.
- [x] Add positive and negative proofs for empty pipe pairs only when readiness,
      EOF, and peer ownership are exact. Issue/PR: #779 / #780.
- [x] Decide whether duplicate fd aliases can graduate; if not, keep
      `target-fd-table-duplicate` as the stable boundary. Issue/PR: #779 / #780.
- [x] Update resource translation docs, target loader docs, proof-profile docs,
      and refusal inventory after each graduated resource family. Issue/PR: #775
      / #776, #777 / #778, #779 / #780.

Refusal boundaries that remain unless explicitly modeled:

- [!] sockets without a broker contract: `target-socket-syscall-state-unsupported`;
- [!] ambiguous pipe buffers or wake ordering: `kernel-state-unsupported`;
- [!] semaphore eventfds or unknown eventfd waiters: `kernel-state-unsupported`;
- [!] periodic/expired timerfd overrun ambiguity: `kernel-state-unsupported`;
- [!] duplicated fds without shared open-file-description semantics:
  `target-fd-table-duplicate`.

## Goal 5: readiness-aware wait and syscall coverage

Goal 5 may use the Goal 4 resource recipes to graduate waits that depend on
readiness. It must not claim general scheduler or wake ordering. Readiness should
be proven from target-owned recreated descriptors and verified before completion.

Accepted subset candidates:

- `poll`/`ppoll`/`select`/`pselect6` with watched fds that already have accepted
  target recipes;
- level-triggered readiness only;
- bounded fd sets and iovec/pollfd memory that are private, translated, and
  target-owned;
- no signal-mask changes unless Goal 8 has already modeled them;
- deterministic timeout or no-timeout behavior with explicit remaining time.

Tasks:

- [x] Define a portable readiness model for level-triggered waits over accepted
      fd recipes, and record that Goal 5 does not graduate it until fd-set
      ownership, signal-mask, and scheduler-order boundaries are exact. Issue/PR:
      #781 / #782.
- [x] Keep target revents/fd-set gates as a prerequisite for future graduation;
      no broad readiness success is claimed without those gates. Issue/PR: #781
      / #782.
- [x] Record that no new `poll`/`ppoll` readiness proof graduates in Goal 5;
      existing timeout-driven wait proofs remain the supported baseline. Issue/PR:
      #781 / #782.
- [x] Add negative profile coverage for unsupported readiness state, including
      unsupported watched fds, stale readiness, fd-set overflow, and non-null
      signal-mask boundaries. Issue/PR: #781 / #782.
- [x] Preserve active syscall translation boundaries until descriptor/resource and
      timeout accounting gates prove watched resources exactly. Issue/PR: #781 /
      #782.
- [x] Preserve existing timeout-driven wait proofs as baseline-success profiles.
      Issue/PR: #781 / #782.

Refusal boundaries that remain unless explicitly modeled:

- [!] readiness that depends on unmodeled scheduler wake ordering;
- [!] signal-mask-changing waits before Goal 8 support;
- [!] unsupported watched descriptors, nested epoll cycles, or socket readiness;
- [!] ambiguous iovec/fd-set ownership or writable shared memory.

## Goal 6: process context, target libc, and vDSO/vvar boundary

Goal 6 should expand process-context materialization beyond the bounded
argv/env/cwd/auxv pointer block only where target libc and kernel ABI semantics
are explicit. Source vDSO/vvar bytes remain permanently refused.

Accepted subset candidates:

- target-owned `AT_RANDOM` bytes generated by the target restore path and wired
  into the target auxv/pointer block;
- target-owned `AT_EXECFN` strings when path provenance and target executable
  identity are exact;
- bounded auxv entries whose values are either target-owned, target-verified, or
  explicitly refused;
- cwd/env/argv updates that preserve size limits, ownership, and target pointer
  validity;
- libc startup/global state only when tied to a known target libc build and
  verified before completion.

Tasks:

- [x] Inventory every auxv entry currently copied, synthesized, verified, or
      refused by the process-context model; only bounded target-owned metadata and
      selected auxv policy checks are accepted. Issue/PR: #781 / #782.
- [x] Define `target-auxv-v1` as a future-gated per-entry provenance model; Goal
      6 keeps source-owned or ambiguous auxv entries refused. Issue/PR: #781 /
      #782.
- [x] Keep `AT_RANDOM` target-owned materialization as a prerequisite for future
      support; source-owned or ambiguous random bytes stay refused with
      `target-process-context-unsupported`. Issue/PR: #781 / #782.
- [x] Keep `AT_EXECFN` target-owned materialization as a prerequisite for future
      support; ambiguous executable identity stays refused. Issue/PR: #781 /
      #782.
- [x] Define vDSO/vvar policy as target-owned mapping verification only; never
      copy source vDSO/vvar bytes. Issue/PR: #781 / #782.
- [x] Preserve the existing `process-context` positive profile only for exact
      target-owned entries and add negative profiles for source-owned or
      ambiguous entries. Issue/PR: #781 / #782.
- [x] Document target libc build assumptions and refuse unknown libc/global state.
      Issue/PR: #781 / #782.

Refusal boundaries that remain unless explicitly modeled:

- [!] copying source vDSO/vvar bytes;
- [!] source-owned auxv pointers into unmapped or source-only memory;
- [!] unknown target libc startup/global state;
- [!] ambiguous cwd/env/argv pointer ownership or size overflows.

## Goal 7: broader private memory and layout materialization

Goal 7 should widen private target memory coverage only when provenance,
permissions, guard behavior, and pointer ownership are exact. It must not turn
raw source memory copying into executable or kernel-owned state migration.

Accepted subset candidates:

- private anonymous heap/brk ranges with exact bounds, permissions, and guard
  policy;
- private `mmap` ranges with deterministic target addresses or explicit
  relocation metadata;
- read/write private data pages whose pointers are either internal, translated,
  or intentionally opaque data;
- target-owned TLS/TCB backing that remains verified by existing gates;
- memory layout gaps and guard pages that are intentionally preserved or refused.

Tasks:

- [x] Define the brk/heap layout model as a future-gated bounded layout contract;
      ambiguous allocator/kernel state remains refused. Issue/PR: #781 / #782.
- [x] Define the private `mmap` layout model as a future-gated alignment, guard,
      fixed-address, and relocation contract; unsupported shapes stay refused.
      Issue/PR: #781 / #782.
- [x] Record pointer ownership classes for restored private data: target pointer,
      translated pointer, opaque scalar, and unsupported source-only pointer.
      Issue/PR: #781 / #782.
- [x] Preserve existing target gates for final permissions, guard pages,
      zero-fill behavior, and no unexpected executable mappings as prerequisites
      for broader layout support. Issue/PR: #781 / #782.
- [x] Record that Goal 7 does not add new heap/brk or private-mmap positive
      profiles beyond the existing bounded private-memory materialization
      baseline. Issue/PR: #781 / #782.
- [x] Add negative profiles for shared/unsupported mappings, executable data,
      source-only pointers, overlapping ranges, stale hashes, and permission
      mismatches. Issue/PR: #781 / #782.
- [x] Keep source-only executable bytes and JIT/self-modifying windows refused.
      Issue/PR: #781 / #782.

Refusal boundaries that remain unless explicitly modeled:

- [!] executable source bytes or ambiguous executable provenance:
  `mapping-executable-unsupported` / `mapping-provenance-ambiguous`;
- [!] shared mappings without a target sharing contract;
- [!] pointers into source-only mappings, vDSO/vvar, or unsupported resources;
- [!] W+X or self-modifying active windows without target-native regeneration.

## Goal 8: signal delivery and restart semantics

Goal 8 is intentionally late because it composes process context, fd/resource
recipes, readiness, and timeout accounting. It may graduate only narrow restart
or signal subsets where target behavior is identical and verifiable.

Accepted subset candidates:

- blocked signal masks that can be applied and verified before target-native
  continuation;
- empty pending queues with signalfd descriptors already covered by Goal 3;
- interrupted syscalls that can be restarted only when remaining time, signal
  mask, restart block, and result semantics are exact;
- signal delivery state with no active handler frame unless a future model
  materializes the target handler frame natively;
- deterministic `EINTR` outcomes where no restart is claimed.

Tasks:

- [x] Inventory current signal mask, pending signal, alt-stack, signal-frame,
      and restart-block refusals. Issue/PR: #781 / #782.
- [x] Define `target-signal-mask-v1` as a future-gated apply/verify contract for
      blocked masks without queued delivery ambiguity. Issue/PR: #781 / #782.
- [x] Define per-syscall remaining-time contracts for sleep, ppoll/poll,
      timerfd-backed waits, and readiness-aware waits as prerequisites for future
      restart support. Issue/PR: #781 / #782.
- [x] Define that interrupted syscalls return `EINTR` or restart only when the
      syscall-specific contract is exact; all restart-like ambiguity remains
      refused. Issue/PR: #781 / #782.
- [x] Record that Goal 8 adds no new restart success profile beyond exact
      existing signal/signalfd boundaries. Issue/PR: #781 / #782.
- [x] Add negative profiles for pending signals, queued siginfo, active signal
      frames, enabled alt-stacks, restart blocks without remaining time, and
      handler delivery ambiguity. Issue/PR: #781 / #782.
- [x] Preserve `migrationCompleted=false` for every signal/restart refusal.
      Issue/PR: #781 / #782.

Refusal boundaries that remain unless explicitly modeled:

- [!] active signal frames or source handler stacks;
- [!] queued pending signals or siginfo without target delivery model;
- [!] alt-stack state without target-native frame materialization;
- [!] restart blocks without exact remaining time and syscall-specific contract;
- [!] signal-mask-changing waits before the target gate verifies the final mask.

## Cross-goal completion criteria

- [x] Each goal graduates at least one narrow support subset or explicitly
      records why the family remains refused. Issue/PR: #781 / #782.
- [x] Every graduated subset has docs, unit tests, positive proof automation,
      nearby negative tests, and stable refusal behavior outside the subset.
      Issue/PR: #775 / #776, #777 / #778, #779 / #780, #781 / #782.
- [x] The Goal 3 graduated profiles (`epoll-recreate`, `signalfd-recreate`) keep
      passing. Final closure validation recorded in #781 / #782.
- [x] The original positive proof matrix from `goal.md` keeps passing. Final
      closure validation recorded in #781 / #782.
- [x] Full validation has run with timings whenever VM/assets/restore behavior is
      touched. Issue/PR: #775 / #776, #777 / #778, #779 / #780.
- [x] No new success path uses source-ISA emulation, sidecar runtime, app hooks,
      or source text replay. Issue/PR: #781 / #782.
