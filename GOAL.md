# Goal — Extend `machinen move` proof envelopes beyond ping

## North star

Grow `machinen move` from the proven Debian `iputils-ping` cross-arch envelope into a small matrix of real distro utilities that can be saved from one VM and live-loaded into another VM with target-native continuation semantics.

This is **not** a claim of generic cross-architecture VM snapshot/restore or arbitrary process restore. Each phase must state and prove its own narrow support envelope.

## Current baseline

| Capability                               |      Status | Notes                                                                                       |
| ---------------------------------------- | ----------: | ------------------------------------------------------------------------------------------- |
| Cross-arch VM snapshot/restore           | Not claimed | VM snapshot/restore remains VM-only/same-architecture scoped unless separately proven.      |
| Generic cross-arch process restore       | Not claimed | Unsupported process state must fail closed.                                                 |
| Debian `iputils-ping` arm64 → amd64 move |      Proven | Original target distro `/usr/bin/ping`, direct guest loader, no leaked target `icmp_seq=1`. |
| Repeatable ping proof harness            |      Proven | `pnpm proof-move-ping-cross-arch`.                                                          |

## Rules for all phases

| Rule                       | Requirement                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Original distro binary     | Target must run the target distro utility, not a Machinen replacement binary.                           |
| Target-native continuation | No source ISA emulation and no metadata-only success.                                                   |
| Fail closed                | Missing package/layout/fd/terminal/state evidence must refuse before claiming load success.             |
| Narrow claims              | Each utility gets a named support envelope; no generic snapshot/restore claims.                         |
| Cross-arch proof           | Accepted envelopes should be proven arm64 source → amd64 target when practical.                         |
| Evidence first             | Capture bundles must include source evidence, target validation, loader evidence, and refusal evidence. |

## Envelope model

An envelope is the supported continuation contract for one binary, runtime, or family of binaries. It answers five questions:

| Question                            | Why it matters                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| What command shape is accepted?     | Prevents accidentally claiming support for every invocation of a tool.                                        |
| What state means “continued”?       | `ping` continues by sequence/counters; `tail` continues by file offset; `vi` continues by buffer/cursor/mode. |
| Where is the safe handoff point?    | Mutation must happen before wrong output leaks and while app invariants are stable.                           |
| How is target-native state created? | The target runs its own distro binary and receives reconstructed resources or patched target-native memory.   |
| How is success proven?              | Each envelope needs visible continuation evidence, not just accepted metadata.                                |

The envelopes are binary- or runtime-anchored, but each one should graduate reusable primitives underneath it.

| Envelope proof | Binary-specific part                                             | Reusable primitive to graduate                                                                   |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ping`         | Debian `iputils-ping` `ping_rts` counters and ICMP packet buffer | package/layout validation, ptrace syscall-boundary stop, target memory patching, checksum repair |
| `sleep`        | coreutils sleep timeout semantics                                | timer continuation and elapsed/remaining-time modeling                                           |
| `tail -f`      | coreutils follow behavior                                        | file identity capture, fd recreation, seek-to-offset, no-duplicate stream validation             |
| `less`         | pager viewport/session behavior                                  | PTY capture, termios/window-size recreation, screen-diff validation                              |
| `vi`           | editor cursor/mode/buffer state                                  | terminal-app safe points, viewport restoration, layout-metadata-driven app state patching        |
| Node service   | V8/libuv/app service state                                       | heap graph descriptors, event-loop wait classification, listener/timer materialization           |

## Reusable move primitives

| Primitive                                                                  | Reused by                                    |
| -------------------------------------------------------------------------- | -------------------------------------------- |
| `/proc` process, fd, mapping, thread, syscall, wchan, and register capture | every envelope                               |
| executable package/build-id/path validation                                | every known ELF envelope                     |
| generated target layout metadata                                           | C utilities and runtimes with known packages |
| ptrace stop at syscall or event boundary                                   | `ping`, future socket/file/terminal tools    |
| `process_vm_writev` or ptrace memory writes                                | envelopes with known target-native layouts   |
| regular-file reopen and seek                                               | `tail`, `less`, `vi`, file readers           |
| PTY, termios, and window-size recreation                                   | `less`, `vi`, shells, TUIs                   |
| timer continuation descriptors                                             | `sleep`, event loops, schedulers             |
| listener/socket/resource materialization                                   | servers and event-loop runtimes              |
| fail-closed refusal engine                                                 | every envelope                               |

## Explicit non-goals

| Non-goal                                          | Reason                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Translate whole VM snapshots across architectures | Guest kernel, CPU, device, page-table, and process state are architecture-specific.                                            |
| Move arbitrary opaque ELF processes cross-arch    | Raw stacks, pointers, function pointers, heaps, locks, and active syscalls have no generic target-native meaning.              |
| Claim any Node app is supported                   | Node support must be limited to decoded heap/resource/event-loop envelopes, with workers/addons/active requests refused first. |
| Use source-ISA emulation as success               | Emulation can run source code, but it is not target-native continuation.                                                       |
| Replace the target app with a Machinen helper     | The final continued process must be the target distro binary for that envelope.                                                |

## Phase plan

| Phase | Target                          | Main state to preserve                                   | Loader strategy                                                               | Success proof                                                                     | Status                                                      |
| ----- | ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 4A    | Existing proof audit            | Reusable capture/restore primitives                      | No product change yet                                                         | Matrix mapping old proofs to move primitives.                                     | Implemented in this document.                               |
| 4B    | `/bin/sleep`                    | Remaining timeout, signal behavior, exit status          | Launch target distro `sleep`; reconstruct timer continuation at safe boundary | Source sleep partly elapsed; target exits after remaining time, not full restart. | Implemented and locally proven.                             |
| 4C    | `tail -f file`                  | File path, fd identity, file offset, follow mode, stdout | Launch target distro `tail`; seek/recreate offset; resume follow              | Source emits lines 1..N; target emits N+1 onward with no duplicates/skips.        | Implemented and locally proven.                             |
| 4D    | `less file` read-only           | File path, explicit line, script PTY                     | Launch target distro `less` under a script-owned PTY                          | Target loader starts original less at captured line when less exists in rootfs.   | Implemented; rebuilt assets include less.                   |
| 4E    | `vi file` read-only             | File path, explicit line, normal mode, script PTY        | Launch target distro `vi` under a script-owned PTY                            | Target loader starts original vi at captured line when vi exists in rootfs.       | Implemented; rebuilt assets include vim-tiny.               |
| 4F    | `vi file` dirty buffer          | Argv-evidence inserted text, cursor line, modified flag  | Target-native `vi` receives reconstructed dirty text through ex command       | Dirty text is injected into original target vi at load.                           | Implemented for argv-evidence dirty text only.              |
| 4G    | `vi` richer session             | Argv-evidence search pattern plus dirty text             | Target-native vi receives search and dirty-buffer commands                    | Search command and dirty text are replayed into original target vi.               | Implemented for argv-evidence search only.                  |
| 4H    | Cross-arch proof harness matrix | Accepted local envelopes                                 | Repeatable local proof harness                                                | One command proves sleep/tail and probes terminal tools.                          | Implemented as `pnpm proof-move-envelope-matrix -- --json`. |

## Phase 4A — proof audit

Deliverables:

- Inventory existing proofs/scripts for timer, fd, PTY, terminal, cursor, and resource reconstruction primitives.
- Mark which pieces can be reused directly in product `machinen move` and which remain proof-only.
- Produce a matrix with:
  - source evidence available,
  - target materialization approach,
  - refusal conditions,
  - validation commands,
  - claim boundaries.

Exit criteria:

- `goal.md` updated with the chosen implementation order and reusable primitives.
- No product behavior changed unless separately scoped.

## Phase 4B — `/bin/sleep`

Support envelope:

- Single-process distro `/bin/sleep` or `/usr/bin/sleep`.
- Single remaining relative timeout.
- No unsupported inherited fds beyond standard streams unless explicitly modeled.
- Same package/path validation where applicable.

Required evidence:

- Source argv and executable identity.
- Source safe timer boundary / syscall evidence.
- Elapsed/remaining timeout estimate.
- Target loader evidence proving the target does not restart the full original timeout.

Success criteria:

- Start `sleep 30`, save after a known delay, load into target, and prove target exits after approximately remaining time.
- Ctrl-C/signal behavior remains sensible or explicitly refused.
- Cross-arch proof added when stable.

## Phase 4C — `tail -f file`

Support envelope:

- Distro `tail -f <regular-file>`.
- One followed regular file.
- Standard output to file/pipe/PTY as modeled.
- No log rotation support initially unless explicitly added.

Required evidence:

- Source executable/package identity.
- File identity/path and offset.
- Follow mode and polling/inotify state classification.
- Target recreated fd and seek evidence.

Success criteria:

- Source observes lines 1..N.
- Load target and append lines N+1..M.
- Target emits only N+1..M: no duplicate line N, no skipped N+1.

## Phase 4D — `less file` read-only

Support envelope:

- Distro `less <regular-file>` in a PTY.
- Read-only session.
- Terminal size fixed during capture/load.
- Preserve viewport/cursor sufficiently for visible continuation.

Required evidence:

- File path/identity.
- Explicit line from argv, for example `less +42 /tmp/file`.
- Target script-PTY loader evidence.
- Refusal for missing `less`, missing `script`, or unsupported implicit viewport state.

Success criteria:

- Target starts original distro `less` under a script-owned PTY at the captured line.
- Arbitrary post-launch viewport movement is not claimed until terminal state capture is deeper.

## Phase 4E — `vi file` read-only

Support envelope:

- Distro `/usr/bin/vi +<line> <regular-file>` or selected Debian vi/Vim provider.
- No unsaved edits for the read-only envelope.
- Normal mode at an explicit line.

Required evidence:

- vi provider/package/version identity.
- File identity/path.
- Explicit line from argv.
- Target script-PTY loader evidence.

Success criteria:

- Target starts original distro vi under a script-owned PTY at the captured line.
- Arbitrary post-launch cursor movement is not claimed until terminal/editor state capture is deeper.

## Phase 4F — `vi file` dirty buffer

Support envelope:

- Simple inserted text carried as argv evidence, for example a captured `+normal! Go...` command.
- No plugins, modelines, swap recovery, multi-window, or complex undo initially.
- Fail closed for typed post-launch edits until Vim buffer/swap/layout evidence is decoded.

Required evidence:

- Dirty buffer text from source argv evidence.
- Target-native vi command that reconstructs the dirty buffer.
- Modified-buffer intent in loader evidence.

Success criteria:

- The target original distro vi receives the captured inserted text at load.
- No helper editor replaces distro vi.
- Typed unsaved edits that are only present in source heap/swap remain a future extension.

## Phase 4G — richer vi session

Candidate additions:

- Search pattern and direction from argv evidence, for example `+/needle`.
- Marks, registers, and basic undo remain refused until decoded from real vi/Vim state evidence.

Exit criteria:

- Each feature has a separate acceptance/refusal condition.
- Unsupported combinations fail closed.

## Phase 4H — proof harness matrix

Deliverables:

- A repeatable script/package command for accepted envelopes: `pnpm proof-move-envelope-matrix -- --json`.
- JSON output summarizing sleep/tail proof results and terminal-tool availability.
- Smoke manifest entries labeled as proof/audit when promoted to broad smoke.

Success criteria:

- Sleep exits after remaining time, not the full original time.
- Tail emits appended lines after the captured offset with no duplicates.
- Terminal envelopes are probed and run when rebuilt assets include `less`, `vi`, and `script`.
- Harness avoids claiming broad generic snapshot/restore.

## Validation expectations

For each implementation phase, run the smallest checks covering changed behavior plus relevant static checks:

| Change type                    | Expected validation                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| TS/runtime/CLI                 | `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, targeted Vitest                      |
| Public exports/docs            | `pnpm run build:docs`                                                                                |
| Proof harness                  | targeted proof command plus manifest check if manifest changes                                       |
| VM lifecycle/VMM/rootfs/assets | targeted smoke or full `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` when required |

## Open questions

| Question                                                       | Default answer for now                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Should `vi` dirty buffer use Vim internals or terminal replay? | Prefer target-native state reconstruction; terminal replay can be refusal/proof evidence but not final success by itself. |
| Do we support non-Debian utility builds?                       | Not initially; package/layout metadata must validate or refuse.                                                           |
| Do we preserve arbitrary PTY state?                            | No; support only explicitly modeled PTY/termios/window-size state.                                                        |
| Do socket/resource refusals block utility envelopes?           | Only if the envelope cannot semantically reconstruct the resource target-natively.                                        |
