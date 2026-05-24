# Goal: transparent native cross-ISA migration

Target success path:

```text
arm64 VM / Linux process state -> portable machine snapshot -> amd64 VM restore
```

Native-transparent success means:

- no Node/Bun sidecar on the restore success path;
- no source-ISA emulation as success;
- no app hooks;
- no captured source text reused as target code;
- unsafe or ambiguous state fails closed with a precise refusal code;
- `migrationCompleted=true` only after target-native completion and all relevant
  target gates pass.

Automation rules for every task below:

- Base new work on `portable-snapshots`.
- Use one issue, one branch, and one PR per task.
- Keep portable snapshot fd-backed and machine-restore work off `main` until the
  whole goal is ready.
- Prefer the smallest safe target-native proof slice; if a contract is not exact,
  add/refine a fail-closed refusal instead.
- Use `pnpm exec fallow` for fallow checks.
- Use `NPM_CONFIG_USERCONFIG=/dev/null` for `npx` commands.
- Include wall-clock timings in every validation report.
- Run remote setup non-invasively under `/tmp`.
- Remote defaults:
  - arm64 source: `friend@100.126.46.90`
  - amd64 target / Proxmox: `root@192.168.0.8`
  - Proxmox CT: `111`
  - Docker image: `node:22-bookworm`

Validation tiers:

- Docs/TS/runtime-only task:
  - `pnpm run build:docs`
  - `pnpm run format:check`
  - `pnpm run lint`
  - `pnpm run typecheck`
  - focused `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run ...`
  - `pnpm exec fallow audit --changed-since origin/portable-snapshots`
- VM/VMM/rootfs/assets/CLI/snapshot/restore/virtio/FUSE/lifecycle task:
  - all docs/TS/runtime checks above
  - full `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`
  - full `pnpm smoke-tests`
  - relevant remote arm64->amd64 proof profile
- Workflow/CI task or explicit CI request:
  - `AGENT_CI_DOCKER_HOST=unix:///Users/peterp/.orbstack/run/docker.sock NPM_CONFIG_USERCONFIG=/dev/null npx agent-ci run --all -q -p`

## Status legend

- `[x]` complete and merged.
- `[ ]` todo.
- `[~]` partial: has a narrow proof or refusal, but not the full general claim.
- `[!]` refusal-only boundary: keep failing closed until a later task models it.

## Completed proof ladder

- [x] Establish portable/native migration proof ladder through native restore
      planning, descriptors, materializers, completion gates, active-syscall VM
      proof, controlled two-thread proof, and roadmap updates.
- [x] Add empty-pipe `read(fd, buf, count)` active-syscall VM proof. - Issue/PR: #697 / #698 - Refusal: `target-fd-read-state-missing` - Profile: `PORTABLE_MACHINE_REMOTE_SOURCE_TARGET=pipe-read`
- [x] Add eventfd counter-0 non-semaphore `read` active-syscall VM proof. - Issue/PR: #699 / #700 - Profile: `eventfd-read`
- [x] Add timerfd `read` active-syscall VM proof with modeled remaining time. - Issue/PR: #701 / #702 - Profile: `timerfd-read`
- [x] Tighten active socket accept/connect refusal. - Issue/PR: #703 / #704 - Refusal: `target-socket-syscall-state-unsupported`
- [x] Add process-context target handoff proof. - Issue/PR: #705 / #706 - Includes bounded env/cwd handoff and `metadata-only` planning. - Profile: `process-context`
- [x] Add extended native context / fd syscall proof slice. - Issue/PR: #707 / #708 - Includes visible argv/env/cwd/selected auxv proof, safe regular-file
      active `read` planner/trampoline path, epoll/signalfd refusal tightening.
- [x] Add regular-file active `read` VM proof. - Issue/PR: #709 / #710 - Profile: `file-read`
- [x] Model target initial-stack process context. - Issue/PR: #711 / #712 - Includes bounded argv/envp/auxv pointer block materialization and verify.
- [x] Tighten futex and rseq boundaries. - Issue/PR: #713 / #714 - Refusals: `futex-state-unsupported`, `rseq-state-unsupported`
- [x] Refresh native snapshot roadmap. - Issue/PR: #715 / #716
- [x] Add regular-file active `write` VM proof. - Issue/PR: #717 / #718 - Profile: `file-write`
- [x] Add `pread64` active-syscall VM proof. - Issue/PR: #719 / #720 - Profile: `file-pread`
- [x] Add `pwrite64` active-syscall VM proof. - Issue/PR: #721 / #722 - Profile: `file-pwrite`
- [x] Add single-iovec `readv`/`writev` active-syscall boundary. - Issue/PR: #723 / #724 - Profiles: `file-readv`, `file-writev`

## Ordered remaining tasks

### A. Keep current proven slices regression-safe

- [x] Add an automation runner that can execute a named remote proof profile and
      record timing, remote paths, and target gate results. - Inputs: profile name, arm64 host, amd64 host, work dir prefix. - Outputs: JSON summary, logs path, pass/fail, timings. - Must support current profiles: `pipe-read`, `eventfd-read`,
      `timerfd-read`, `file-read`, `file-pread`, `file-readv`, `file-write`,
      `file-pwrite`, `file-writev`, `process-context`, default
      `two-thread-ppoll`.
- [x] Add a profile matrix document or script data file that names every native
      proof profile, required source fixture, traced fd, expected gates, and
      expected refusal or success result.
- [x] Add a lightweight checker that refuses to report success unless
      `descriptorGateCompleted=true`, target verifier/state/resource/frame/
      register/TLS/stack/private-memory/executable/signal gates pass, and the
      relevant active-syscall/process-context/thread gate passes.

### B. More active syscall/resource families without readiness ambiguity

Do these one at a time. Each family must either complete target-natively under a
narrow exact contract or fail closed with a stable refusal.

- [ ] Pick the next low-ambiguity active syscall/resource family and write the
      issue with exact acceptance/refusal criteria before code changes. - Candidate classes should avoid readiness races, shared writeback
      semantics, credential/namespace coupling, and source-ISA emulation.
- [ ] For each accepted syscall family, add source fixture(s) under
      `packages/microvm/assets/`.
- [ ] Extend `native-process-capture.c` tracing for the syscall name/number and
      any traced fd needed by the proof.
- [ ] Extend native active-syscall classification with decoded arguments and a
      precise policy type.
- [ ] Require captured memory for any pointer argument; refuse missing,
      unreadable, overlong, ambiguous, or multi-segment state unless explicitly
      modeled.
- [ ] Require a target buffer or target memory translation for every user memory
      read/write effect.
- [ ] Add target restore-loader/trampoline step(s) only after the target-native
      syscall completion contract is exact.
- [ ] Add fail-closed unit tests for missing resource rows, wrong resource kind,
      unsafe flags, unsafe offsets/counts, missing target mapping, partial
      transfer, unsupported pointer shape, and non-modeled syscall variants.
- [ ] Add remote proof profile(s) only for accepted safe cases.
- [ ] Update docs after each family: - `docs/snapshot/native-active-syscall-policy.md` - `docs/snapshot/target-guest-active-syscall-restore.md` - `docs/snapshot/native-next-frontier.md` - `docs/snapshot/native-cross-isa-proof-roadmap.md` when the roadmap
      changes.

### C. Process context beyond bounded argv/envp/auxv pointer block

- [x] Keep current bounded argv/env/cwd/selected-auxv model passing.
- [x] Inventory target libc startup/global expectations that are observable after
      the restore point.
- [x] Decide which auxv entries are safe to materialize, which are target-owned,
      and which must refuse.
- [x] Model or refuse `AT_RANDOM` with an explicit target-owned randomness
      contract.
- [x] Model or refuse `AT_EXECFN` with target path/provenance ownership.
- [x] Model or refuse `AT_BASE`, interpreter, vDSO, and vvar dependencies.
- [x] Add tests that prove unsafe auxv/vDSO/vvar values cannot be copied from the
      source ISA as success.
- [x] Add a remote process-context proof that exercises the newly modeled context
      value from target-native code.

### D. Private memory, heap, brk, and mmap coverage

- [x] Keep current private writable range materialization passing.
- [x] Broaden heap/brk/mmap layout policy only where provenance and ownership are
      explicit.
- [x] Preserve guard-page semantics for every widened private memory range.
- [x] Refuse writable+executable memory unless a later JIT/code provenance task
      models it exactly.
- [x] Refuse shared writable memory unless coherence and ownership are modeled.
- [x] Refuse unreadable or partially captured mappings with stable detail.
- [x] Add target-side verification for every new materialized memory class.
- [x] Add tests for pointer ownership, permission transitions, guard behavior,
      missing bytes, and overlapping target mappings.

### E. Target libc, vDSO, vvar, and special mappings

- [ ] Inventory every special mapping currently observed in accepted proof
      profiles.
- [ ] Decide per mapping: target-owned recreate, target-file provenance verify,
      data materialize, or refuse.
- [ ] Add stable refusal codes/details for every unsupported special mapping.
- [ ] Model target vDSO/vvar only when target kernel semantics are explicit; do
      not copy source vDSO/vvar bytes as success.
- [ ] Add target-native verification that modeled special mapping data is valid
      on amd64.

### F. Signals, interrupted syscalls, and restart semantics

- [!] Keep pending signals, active signal delivery, alt-stack frames, and generic
  restart blocks refused by default.
- [ ] Capture pending signals, blocked masks, signal dispositions needed by the
      restore contract, and interrupted syscall state.
- [ ] Model signal-mask restore for safe cases without allowing pending or active
      signal delivery to pass silently.
- [ ] Define remaining-time accounting per blocking syscall family.
- [ ] Restart only when target can prove equivalent signal/restart semantics.
- [ ] Preserve current refusals for plain `EINTR`, `ERESTART*`-style results, and
      other unmodeled negative errno returns until modeled.
- [ ] Add tests for pending signal queue, siginfo ownership, alt-stack state,
      signal trampoline frames, restart-block state, and target timeout
      accounting.

### G. Futex, rseq, and general multithread restore

- [!] Keep current futex and rseq refusal tightening in place.
- [ ] Model futex word translation and memory ownership.
- [ ] Model futex wait queues, wake/requeue ordering, timeout accounting,
      robust-list owner-death semantics, and PI futex cases or refuse them with
      exact detail.
- [ ] Model rseq target registration lifecycle.
- [ ] Translate rseq abort IPs and critical-section state or refuse.
- [ ] Model TLS ownership for rseq areas.
- [ ] Extend controlled thread-spawn beyond short-lived target tasks only after
      scheduler-visible state is explicit.
- [ ] Add remote proof for each newly accepted multithread/futex/rseq slice.
- [ ] Keep general scheduler state refused until modeled.

### H. Kernel resources and fd recipes beyond current proofs

- [~] Keep current regular-file, stdio, close-fd, synthetic empty pipe, synthetic
  empty eventfd, and synthetic timerfd recipes passing.
- [ ] Add or refine refusals for unsupported descriptor state before target
      execution.
- [ ] Decide broker/model/refuse policy for PTYs.
- [ ] Decide broker/model/refuse policy for raw sockets.
- [ ] Keep sockets refused until accept/connect/listen queues, peer identity,
      credentials, namespaces, socket options, and readiness are modeled or
      brokered.
- [ ] Keep epoll refused until interest lists, ready-list ordering, wakeups, and
      nested epoll semantics are modeled or brokered.
- [ ] Keep signalfd refused until pending signal queue and siginfo ownership are
      modeled.
- [ ] Keep generic eventfd/timerfd state refused except for the already modeled
      narrow active-read recipes.
- [ ] Add target fd-table tests for duplicate fds, unsupported descriptors,
      close-on-exec, safe flag filtering, and missing reopen recipes.

### I. Code identity, unwind, stack, and arbitrary binary boundary

- [~] Keep current target executable provenance, return-chain, frame/register,
  stack-window, TLS, and real-utility continuation gates passing.
- [ ] Expand source/target code identity mapping only when build-id/sha256/path
      provenance and target module inventory match.
- [ ] Require unwind/DWARF/sidecar metadata for every stack frame in any newly
      accepted arbitrary frame shape.
- [ ] Translate or refuse every callee-saved register slot required by target
      unwind metadata.
- [ ] Classify pointer-shaped words as pointer, code pointer, thread pointer, or
      integer before relocation.
- [ ] Refuse ambiguous, missing, optimized-away, or unowned stack/heap values.
- [ ] Keep JIT/self-modifying code refused until runtime code provenance and
      relocation metadata exist.
- [ ] Maintain the arbitrary-boundary checklist: 1. pointer-shaped words classified or refused; 2. return addresses mapped through source/target code identity or refused; 3. every stack frame has unwind/DWARF/sidecar metadata or refuses; 4. active syscall/restart state modeled or refused; 5. signal trampoline/alt-stack frame decoded or refused; 6. TLS, rseq, and futex state modeled or refused; 7. target executable/library build identity checked or refused; 8. kernel resources have reopen/broker recipes or precise refusals; 9. vDSO/vvar/special mappings recreated or refused; 10. JIT/self-modifying code has runtime metadata or refuses.

### J. Portable machine snapshot and target VM restore hardening

- [~] Keep raw cross-ISA `.vmstate` restore refused as
  `cross-isa-vmstate-restore-unsupported`.
- [ ] Keep portable-machine snapshots fd-backed.
- [ ] Refuse target execution when manifest `capture.sourceArch` /
      `target.arch` mismatches are detected.
- [ ] Preserve descriptor, byte, and provenance hashes for every target-native
      continuation and restore section.
- [ ] Add descriptor schema/version tests for every new restore section.
- [ ] Keep target-loader completion gated on descriptor consumption and native
      marker success.
- [ ] Add negative VM proof tests for malformed descriptors, missing sections,
      unsupported versions, and failed native markers.

### K. Automation and reporting

- [x] Create an automation command that opens an issue from a task template,
      creates a branch, runs the requested implementation command, validates,
      pushes, and opens a PR against `portable-snapshots`.
- [x] Add reusable PR body generation with Problem/Solution/Validation and timing
      sections.
- [x] Add validation log capture so every run records command, elapsed time,
      commit, branch, remote hosts, profile, and paths.
- [x] Add a command to run only the relevant focused vitest set for a touched
      subsystem.
- [x] Add a command to run the full required gate set when VM/VMM/rootfs/assets or
      target restore wiring changes.
- [x] Add a command to update `goal.md` task status after a PR merges.
- [x] Add a command to close non-default-base issues manually when GitHub does not
      auto-close them after merging to `portable-snapshots`.

### L. Final transparent restore claim

- [ ] Define the constrained class of real Linux processes that is fully
      supported.
- [ ] Automate arm64 capture and amd64 restore for that class.
- [ ] Prove target-native execution continues after the restore point.
- [ ] Prove no source-ISA emulation, sidecar runtime, app hook, or source text
      reuse is involved.
- [ ] Prove every unsupported state in the class boundary has a stable refusal
      code and telemetry.
- [ ] Update user-facing docs to clearly distinguish supported, refused, and
      deferred states.
- [ ] Only then make the full native-transparent cross-ISA restore claim.

## Stable refusal codes to preserve or extend

- `target-fd-read-state-missing`
- `target-fd-write-state-missing`
- `target-socket-syscall-state-unsupported`
- `target-epoll-syscall-state-unsupported`
- `target-signalfd-state-unsupported`
- `target-process-context-unsupported`
- `target-sleep-remaining-time-missing`
- `target-ppoll-timeout-missing`
- `futex-state-unsupported`
- `rseq-state-unsupported`
- `syscall-restart-unsupported`
- `blocking-syscall-state-unsupported`
- `syscall-argument-state-unsupported`
- `cross-isa-vmstate-restore-unsupported`

## Current successful remote proof profiles

- `pipe-read`
- `eventfd-read`
- `timerfd-read`
- `file-read`
- `file-pread`
- `file-readv`
- `file-write`
- `file-pwrite`
- `file-writev`
- `process-context`
- default `two-thread-ppoll`
