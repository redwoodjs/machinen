# Goal 3: replace selected fail-closed refusals with exact native models

Goal 2 made unsupported or ambiguous native cross-ISA state fail closed with
stable refusal codes. Goal 3 is the next step: implement the proper target-native
model for selected refused families, one family at a time, without broadening the
success claim by accident.

A stable refusal code is not a bug by itself. It is the safety rail that lets us
turn an unsupported family into a supported one only after the portable state
model, target-native restore path, negative tests, and positive proof profiles are
complete.

## Baseline carried forward

The accepted success class from `goal.md` remains unchanged unless an item in this
ledger explicitly graduates a refused family:

- arm64 process state -> portable machine snapshot -> amd64 VM restore;
- target-native completion only;
- no Node/Bun sidecars;
- no source-ISA emulation as success;
- no app hooks;
- no source text reused as target code;
- unsafe or ambiguous state fails closed;
- `migrationCompleted=true` only after target-native completion and all relevant
  target gates pass.

The Goal 2 refusal profiles are now the regression guard. A task in this file may
flip a specific negative profile from `expectedResult: "refusal"` to success only
when that exact state family has a complete target-native model and proof.

## Success criteria

- Each implementation task starts from a stable refusal code and keeps that code
  for cases outside the new supported subset.
- The supported subset has a documented portable representation, restore recipe,
  target gate contract, and failure modes.
- Positive proof automation demonstrates target-native amd64 completion for the
  new subset with `migrationCompleted=true` and `descriptorGateCompleted=true`.
- Negative proof automation still refuses unsafe variants with exact refusal
  codes and `migrationCompleted=false`.
- The original positive proof matrix from `goal.md` keeps passing unchanged.
- Permanent invariants remain refused and are not treated as backlog support
  tasks.

## Automation rules

- Base each task on `portable-snapshots`.
- Use one issue, one branch, and one PR per task.
- Work on one refused family at a time.
- Prefer a narrower supported subset over a broad or ambiguous model.
- Keep the existing negative profile until the positive profile for the same
  state is implemented and passing.
- When graduating a refusal, add both:
  - a positive proof profile for the exact accepted shape; and
  - negative proof profiles or unit tests for nearby unsafe shapes.
- Preserve precise refusal codes for unsupported variants.
- Include wall-clock timings for validation.
- Run full smoke tests when VM/VMM/rootfs/assets/CLI/snapshot/restore behavior is
  touched.

## Status legend

- `[ ]` todo.
- `[x]` complete and merged.
- `[!]` permanent or intentionally refused invariant.
- `[~]` partial implementation exists but is not yet a supported success claim.

## A. Permanent invariants that stay refused

These are not future support tasks unless the project goal changes. They protect
the native-transparent contract.

- [!] Keep raw cross-ISA `.vmstate` restore refused. Whole-VM machine state is
  architecture-specific and is not the portable machine snapshot format.
- [!] Keep source vDSO/vvar byte copying refused. Target vDSO/vvar mappings are
  target-owned and may be recreated or verified, never copied from the
  source ISA.
- [!] Keep source-ISA emulation refused as a success path.
- [!] Keep Node/Bun sidecars refused as a native migration success path.
- [!] Keep app hooks refused as a required success mechanism.
- [!] Keep source text replay refused as target code materialization.
- [!] Keep ambiguous descriptor provenance refused unless provenance becomes
  exact and hash-gated before target-native completion.

## B. Graduation harness for refused families

Before implementing any specific family, make the refusal-to-support workflow
repeatable.

- [x] Add a proof-runner convention for a profile graduating from refusal to
      support, including the old refusal code, accepted subset name, and unsafe
      variants that must still refuse.
- [x] Add reporting that shows which Goal 2 refusal profiles remain
      intentionally refused and which have graduated to success.
- [x] Add a checklist template for every family: portable state model, target
      restore recipe, target gates, positive profile, negative variants, docs,
      and validation timings.
- [x] Ensure a graduated profile cannot pass if `migrationCompleted=true` is set
      before descriptor and target-native gates complete.

## C. Epoll reconstruction for known fd recipes

First likely support candidate. Rebuild epoll only when every watched fd is itself
restorable by an existing or newly proven recipe.

Accepted subset to model first:

- epoll instance with a finite interest list;
- watched fds backed by accepted target fd recipes;
- level-triggered readiness only, unless edge-triggered state is explicitly
  modeled;
- no nested epoll;
- no ambiguous ready-list ordering claim;
- active `epoll_wait` may complete only when its timeout/events/fd mapping are
  fully modeled.

Tasks:

- [x] Define the portable epoll state schema: epoll fd, watched target fd map,
      events, user data, flags, and ordering limits.
- [x] Add descriptor validation that refuses watched fds without accepted target
      recipes.
- [x] Implement target-native epoll recreation using target fds and
      `epoll_ctl`.
- [x] Add target gates proving recreated interest lists match the portable
      descriptor.
- [x] Add a positive proof profile for the accepted epoll subset.
- [x] Keep/refine negative profiles for nested epoll, edge-triggered state that
      is not modeled, unsupported watched fds, and ambiguous active waits.
- [x] Flip only the accepted epoll subset away from
      `target-epoll-syscall-state-unsupported`.

## D. signalfd descriptor recreation without pending queues

Second likely support candidate. Recreate signalfd only when no pending signal
queue or active signal-delivery state must be migrated.

Accepted subset to model first:

- signalfd descriptor with known mask and flags;
- no pending process or thread signals;
- no queued `siginfo` payloads;
- no active signal frame;
- no active alt-stack migration requirement;
- signal mask coordination is explicit and target-verified.

Tasks:

- [x] Define the portable signalfd descriptor schema and mask normalization.
- [x] Add validation that refuses pending signals, queued siginfo, active signal
      frames, active alt-stack state, and malformed masks.
- [x] Implement target-native signalfd recreation with matching mask and flags.
- [x] Add target gates proving descriptor flags and signal mask coordination.
- [x] Add a positive proof profile for empty-queue signalfd recreation.
- [x] Keep/refine negative profiles for queued signals and active signalfd reads
      that require payload/order preservation.
- [x] Flip only the empty-queue descriptor subset away from
      `target-signalfd-state-unsupported`.

## E. Brokered socket model, not arbitrary live sockets

Sockets need an explicit broker or reconnect model. Goal 3 does not add that
broker. Arbitrary live TCP/Unix socket state remains refused.

Accepted subset to consider first:

- opt-in brokered sockets with declared endpoint identity;
- reconnect or reattach semantics defined by the broker, not guessed from kernel
  state;
- no unmodeled accept/connect queues;
- no unmodeled credential, namespace, shutdown, or partial-transfer state;
- readiness semantics are either broker-provided or explicitly recomputed.

Tasks:

- [x] Decide whether Goal 3 supports any socket subset at all, or leaves sockets
      permanently refused for native-transparent migration: Goal 3 leaves sockets
      refused because no broker contract exists.
- [!] If supported, define the broker contract and portable socket descriptor.
  Not supported in Goal 3; future work must start with an explicit broker.
- [!] Add provenance and authorization gates for brokered endpoint identity. Not
  supported in Goal 3 without a broker descriptor.
- [!] Implement target-native broker reattach/reconnect flow. Not supported in
  Goal 3.
- [!] Add positive proof profiles for the narrow brokered subset. Not supported
  in Goal 3.
- [x] Keep/refine negative profiles for listening sockets, connected socketpairs,
      arbitrary TCP/Unix sockets, ancillary data, partial transfers, and
      unbrokered endpoints.
- [x] Keep arbitrary sockets refused with
      `target-socket-syscall-state-unsupported`.

## F. JIT or self-modifying code via target-owned regeneration only

Executable source bytes cannot become target code. Goal 3 does not add a JIT
regeneration provider. Support is possible only when code provenance is
target-native and regeneration is verified.

Accepted subset to consider first:

- code cache has a target-native regeneration recipe;
- source executable bytes are not copied into target executable mappings;
- generated target bytes are hash-gated against the target recipe;
- all instruction pointers and return addresses are translated to target-owned
  code locations;
- writable/executable races and self-modifying windows are quiesced or refused.

Tasks:

- [x] Define executable provenance classes: target-owned static,
      target-generated JIT, source-only executable, ambiguous executable.
- [x] Keep source-only and ambiguous executable mappings refused.
- [!] Define a target-native JIT regeneration descriptor, if any runtime can
  provide one without app hooks. Not supported in Goal 3 because no provider
  can supply target-native regeneration without hooks or source-text replay.
- [!] Add target gates for generated byte hashes, permissions, W^X state, and
  translated code locations. Not supported in Goal 3 without a regeneration
  descriptor.
- [!] Add a positive proof profile only for target-owned regenerated code. Not
  supported in Goal 3.
- [x] Keep/refine negative profiles for source-byte executable copying,
      writable+executable mappings, stale hashes, and self-modifying active
      windows.
- [x] Flip only the target-owned regenerated subset away from
      `mapping-executable-unsupported`: no subset is flipped in Goal 3; the
      refusal remains the stable boundary.

## G. Futex, rseq, and scheduler state: likely quiescent-only

General live futex/rseq/scheduler migration is the hardest class. Goal 3 keeps
kernel futex/rseq/scheduler state refused. Ordinary private memory words may be
copied only as data; no futex wait queue or rseq registration is recreated.

Accepted subset to consider first:

- no thread is blocked in a futex wait;
- no kernel futex wait queue must be preserved;
- futex words are ordinary private memory and have clear ownership;
- no robust-list owner-death transition is pending;
- no rseq critical section is active;
- target rseq registration lifecycle is recreated from target TLS state;
- scheduler ordering is not claimed beyond the explicit target restore plan.

Tasks:

- [x] Define a quiescent futex-word model that treats futex memory as data only
      and refuses all active wait queues.
- [x] Add validation distinguishing ordinary futex words from active futex wait
      state: Goal 3 accepts no explicit futex resource; active futex syscall,
      wait queue, PI futex, or robust-list transition metadata remains refused.
- [x] Define whether target rseq can be recreated safely from target TLS, or must
      remain refused: target rseq registration remains refused in Goal 3.
- [!] Add target gates for thread quiescence, robust-list state, rseq state, and
  scheduler assumptions. Not supported in Goal 3 beyond existing controlled
  thread gates; no futex/rseq target gate can mark migration success.
- [!] Add positive proof profiles only for quiescent accepted subsets, if any. No
  futex/rseq/scheduler subset graduates in Goal 3.
- [x] Keep/refine negative profiles for active futex waits, PI futexes,
      robust-list owner death, active rseq critical sections, and scheduler
      ambiguity.
- [x] Keep general futex/rseq/scheduler migration refused with
      `futex-state-unsupported` and `rseq-state-unsupported`.

## H. Completion criteria for Goal 3

- [x] At least one candidate family has either graduated to a proven
      target-native success subset or been explicitly reclassified as a
      permanent refusal.
- [x] Every graduated subset has docs, unit tests, positive proof automation,
      nearby negative tests, and stable refusal behavior outside the subset.
- [x] The Goal 2 refusal inventory is updated to show any graduated code paths
      and remaining refusal boundaries.
- [x] The original positive proof matrix still passes.
- [x] Full validation has run with timings.
- [x] No new success path uses source-ISA emulation, sidecar runtime, app hooks,
      or source text replay.

Final evidence:

- Graduated support subsets:
  - `epoll-recreate` (`interest-list-v1`) passed with target-native completion —
    37.423s runner / 37s wall, matrix
    `/tmp/machinen-goal3-final-graduated-matrix-1779637299`.
  - `signalfd-recreate` (`empty-queue-v1`) passed with target-native completion —
    34.981s runner / 36s wall, matrix
    `/tmp/machinen-goal3-final-graduated-matrix-1779637299`.
- Reclassified refusal families:
  - sockets remain refused without an explicit broker contract;
  - JIT/self-modifying code remains refused without a target-native regeneration
    descriptor;
  - futex/rseq/scheduler kernel state remains refused; quiescent futex words are
    private memory data only.
- Original positive matrix passed at
  `/tmp/machinen-goal3-final-positive-matrix-1779636627`:
  - `two-thread-ppoll` — 79.504s runner / 80s wall;
  - `pipe-read` — 36.556s runner / 37s wall;
  - `eventfd-read` — 35.833s runner / 36s wall;
  - `timerfd-read` — 36.162s runner / 36s wall;
  - `file-read` — 35.487s runner / 36s wall;
  - `file-pread` — 38.725s runner / 39s wall;
  - `file-readv` — 34.960s runner / 35s wall;
  - `file-write` — 40.692s runner / 41s wall;
  - `file-pwrite` — 36.174s runner / 36s wall;
  - `file-writev` — 39.623s runner / 40s wall;
  - `process-context` — 37.453s runner / 38s wall.
- Final validation passed:
  - `pnpm run build:docs` — 1.873s;
  - `pnpm run format:check` — 0.643s;
  - `pnpm run lint` — 0.239s;
  - `pnpm run typecheck` — 2.641s;
  - `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.315s, 1033 passed / 12 skipped;
  - `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — 2m17.217s.
