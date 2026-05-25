# Goal 2: fail-closed unsupported and ambiguous native state

This ledger extends `goal.md` after the constrained arm64 -> portable machine
snapshot -> amd64 VM proof class. The next objective is not to broaden success by
accident. It is to make every unsupported or ambiguous state fail closed with a
stable refusal before target execution, and to prove that failures never report
`migrationCompleted=true`.

## Baseline already proved

`goal.md` is complete. The current positive proof class is intentionally narrow
and has already passed the remote arm64 -> amd64 target-native matrix:

- `two-thread-ppoll` — controlled two-thread ppoll with active syscall and
  thread gates;
- `pipe-read`, `eventfd-read`, `timerfd-read` — synthetic empty pipe/eventfd and
  timerfd active read blockers;
- `file-read`, `file-pread`, `file-readv` — offset-backed regular-file active
  read proofs;
- `file-write`, `file-pwrite`, `file-writev` — offset-backed regular-file active
  write proofs;
- `process-context` — bounded target-visible argv/env/cwd/selected-auxv context.

For those profiles, success means target-native amd64 completion with
`migrationCompleted=true`, `descriptorGateCompleted=true`, and all required
restore gates passing. Everything in this file is outside that accepted class
unless a later task adds an exact model and proof.

## Success criteria

- Every listed unsafe state has one of:
  - a precise target-native model and proof profile; or
  - a stable refusal code, refusal detail, tests, and docs.
- Negative proof automation can assert:
  - `state` is `refused`, `failed`, or `skipped` as intended;
  - `migrationCompleted=false`;
  - `descriptorGateCompleted=false` unless a descriptor-only negative test is
    explicitly checking post-descriptor native gate failure;
  - no source-ISA emulation, sidecar runtime, app hook, or source text replay is
    accepted as success.
- Positive proof profiles from `goal.md` keep passing unchanged.
- A future `migrationCompleted=true` claim is allowed only for target-native
  completion after all relevant target gates pass.

## Automation rules

- Base each task on `portable-snapshots`.
- Use one issue, one branch, and one PR per task.
- Prefer refusal tightening over a partial model.
- Add negative unit tests first when changing a refusal boundary.
- Add a negative proof-runner profile when the unsafe state can be captured or
  synthesized reproducibly.
- Keep remote setup non-invasive under `/tmp`.
- Include wall-clock timings for validation.

## Status legend

- `[ ]` todo.
- `[x]` complete and merged.
- `[!]` fail-closed boundary: intentionally unsupported until a later exact
  model exists.
- `[~]` partial: some refusal exists, but coverage/details/automation are not
  complete for this goal.

## A. Refusal taxonomy and negative profile automation

- [x] Add an `expectedResult: "refusal"` path to proof-profile automation that
      can assert exact refusal code, target gate values, and
      `migrationCompleted=false` for negative profiles.
- [x] Add profile-matrix fields for unsafe-state family, required refusal code,
      and whether descriptor consumption is expected to be attempted.
- [x] Add summary checks that fail if a negative profile reaches target-native
      success or sets `migrationCompleted=true`.
- [x] Document the negative-profile contract in
      `docs/snapshot/portable-machine-proof-profiles.md`.
- [x] Add a refusal-code inventory table covering all codes used by this goal,
      with owner docs and test files.

## B. Socket state remains refused

- [!] Keep sockets refused until accept/connect/listen queues, peer identity,
  credentials, namespaces, socket options, shutdown state, readiness, and
  partial transfer state are modeled or brokered.
- [x] Add negative tests for captured listening sockets, connected socketpairs,
      in-flight `accept`/`accept4`, in-flight `connect`, and transfer syscalls
      with ancillary-data-shaped arguments.
- [x] Ensure generic `read`/`readv`/`write`/`writev` on socket resources always
      returns `target-socket-syscall-state-unsupported` with fd/resource detail.
- [x] Add or document a negative proof profile for active socket transfer that
      proves `migrationCompleted=false`.
- [x] Update socket refusal docs with queue/peer/credential/namespace fields
      that must be modeled before support can be claimed.

## C. Epoll state remains refused

- [!] Keep epoll refused until interest lists, ready-list ordering,
  edge-triggered delivery state, nested epoll semantics, wakeups, and target
  fd mapping are modeled.
- [x] Add negative tests for epoll resources with multiple watched fds,
      edge-triggered flags, nested epoll, and active `epoll_wait` /
      `epoll_pwait` / `epoll_pwait2`.
- [x] Ensure active epoll waits return
      `target-epoll-syscall-state-unsupported` with decoded timeout/event/fd
      detail when arguments are available.
- [x] Add or document a negative proof profile for active epoll wait refusal.

## D. signalfd and pending signal queues remain refused

- [!] Keep signalfd refused until pending signal queues, siginfo payload
  ownership, delivery ordering, and signal-mask coordination are modeled.
- [!] Keep pending signals, active signal-delivery stops, signal trampoline
  frames, and active alt-stacks refused by default.
- [x] Add negative tests for pending per-thread/process signals, queued siginfo,
      signalfd masks, active signal frames, active alt-stack state, and malformed
      signal masks.
- [x] Ensure active signalfd reads return `target-signalfd-state-unsupported`
      with queue/mask/siginfo detail.
- [x] Add or document a negative proof profile for signalfd read refusal.

## E. Futex, rseq, and scheduler state remain refused

- [!] Keep futex wait state refused until futex word ownership, wait queues,
  wake/requeue ordering, robust-list owner death, priority inheritance,
  timeout, and signal interruption semantics are modeled.
- [!] Keep rseq refused until target registration lifecycle, abort IP
  translation, critical-section state, and TLS ownership are modeled.
- [!] Keep general scheduler state refused until runnable/blocked relationships,
  priorities, affinity, robust lists, and cross-thread ordering are explicit.
- [x] Add negative tests for active `futex`, `futex_time64`, `futex_waitv`,
      robust-list metadata, captured futex resources, and unsupported rseq state.
- [x] Ensure futex refusals use `futex-state-unsupported` with required-model
      detail and rseq refusals use `rseq-state-unsupported` with TLS/abort-IP
      detail.
- [x] Add or document negative proof profiles for futex/rseq refusal where a
      deterministic fixture is practical.

## F. Interrupted syscall and restart state remains refused

- [!] Keep plain `EINTR`, `ERESTART*`-style restart blocks, and
  `restart_syscall` refused unless a family-specific model proves remaining
  time, restart/result contract, signal mask delivery, and target rearm
  policy.
- [x] Add negative tests for restart-block thread state, `restart_syscall`,
      interrupted blocking syscalls without modeled remaining time, and non-null
      signal masks for poll-style syscalls.
- [x] Ensure refusal detail names the missing remaining-time and restart/result
      model.
- [x] Add or document a negative proof profile for restart-state refusal.

## G. JIT and self-modifying code remain refused

- [!] Keep writable+executable memory, anonymous executable code, JIT code,
  self-modifying text, and code without target build identity refused.
- [x] Add tests for writable+executable mappings, executable anonymous mappings,
      changed text hashes, missing build-id/sha256/path provenance, and code
      pointers into unowned regions.
- [x] Ensure refusals distinguish `mapping-executable-unsupported`,
      `mapping-permission-unsupported`, `mapping-provenance-ambiguous`, and
      `target-build-mismatch`.
- [x] Document the exact runtime metadata required before any JIT/self-modifying
      code support can be considered.

## H. Source vDSO/vvar and target libc special state are target-owned or refused

- [!] Keep source vDSO/vvar bytes refused as target code/data. Target kernels own
  target vDSO/vvar mappings.
- [!] Keep unsafe auxv pointers such as `AT_RANDOM`, `AT_EXECFN`, `AT_BASE`, and
  `AT_SYSINFO_EHDR` refused unless target ownership is explicit.
- [x] Add tests proving source vDSO/vvar pages cannot appear in copied target
      memory or executable mapping descriptors.
- [x] Add tests proving refused auxv entries are not copied into target initial
      stack materialization.
- [x] Document target-owned recreate/verify policy for any special mapping that
      remains visible after restore.

## I. Raw cross-ISA VM state remains refused

- [!] Keep raw arm64 `.vmstate` restore into amd64 refused with
  `cross-isa-vmstate-restore-unsupported`.
- [x] Add negative tests for manifests or CLI paths that try to mark raw
      cross-ISA VM state as translated, replayed, emulated, or successful.
- [x] Ensure refusal detail names source arch, target arch, and required portable
      machine process-restore path.
- [x] Document that raw whole-VM state remains same-ISA only unless a future
      target-native machine-state model exists.

## J. Descriptor, manifest, and provenance ambiguity remains refused

- [!] Keep malformed descriptors, missing restore sections, duplicate sections,
  unsupported resource recipes, path escapes, arch mismatches, and failed
  native gate markers refused.
- [x] Add negative tests for every restore section added by future work.
- [x] Add negative proof profiles for malformed descriptor and failed native gate
      markers that assert `migrationCompleted=false`.
- [x] Ensure descriptor/provenance hashes are checked before target-native
      completion is reported.
- [x] Keep target-loader completion gated on descriptor consumption and all
      relevant native restore results.

## K. Final done criteria for Goal 2

- [x] Every `[!]` family above has stable refusal code coverage, docs, and tests.
- [x] Negative proof-profile automation covers each practical unsafe family and
      cannot report success when `migrationCompleted=false` is expected.
- [x] Positive proof-profile matrix from `goal.md` still passes.
- [x] Full validation has run with timings.
- [x] Positive remote proof matrix passed after the fail-closed boundary work.

Validation record:

| Command                                                            |    Timing |
| ------------------------------------------------------------------ | --------: |
| `pnpm run build:docs`                                              |    1.612s |
| `pnpm run format:check`                                            |    0.636s |
| `pnpm run lint`                                                    |    0.228s |
| `pnpm run typecheck`                                               |    2.458s |
| focused `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run ...`       |    2.010s |
| full `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`              |   26.994s |
| `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`    | 2m14.050s |
| `pnpm exec fallow audit --changed-since origin/portable-snapshots` |    0.340s |

Positive remote matrix record:

| Profile            |  Timing |
| ------------------ | ------: |
| `two-thread-ppoll` | 78.549s |
| `pipe-read`        | 40.140s |
| `eventfd-read`     | 34.920s |
| `timerfd-read`     | 43.872s |
| `file-read`        | 37.247s |
| `file-pread`       | 35.002s |
| `file-readv`       | 37.226s |
| `file-write`       | 44.606s |
| `file-pwrite`      | 34.622s |
| `file-writev`      | 35.546s |
| `process-context`  | 34.936s |

- [x] Only after all of the above, update this file so no unchecked or partial
      task items remain.
