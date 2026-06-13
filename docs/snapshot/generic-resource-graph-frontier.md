# Generic resource graph graduation frontier

This document lists follow-up contracts for resource classes that are **not** implicitly supported by the generic resource graph pilot. Each class must get its own descriptor shape, loader/preflight strategy, refusal evidence, and matrix proof rows before it can move from `refused` or `deferred` to `supported`.

## 1. Stdio and pipes

Detailed contract: [`generic-pipes-stdio-graduation.md`](./generic-pipes-stdio-graduation.md).

Current graduated exact shapes:

- `generic-two-process-pipe-reexec` reconstructs an exact two-node producer-to-consumer processGraph/pipeGraph with explicit fd numbers, flags, close-on-exec, nonblocking policy, no hidden shell state, and target-visible output.
- `generic-finite-pipe-buffer-replay` replays descriptor-captured finite pipe bytes into a target-native consumer with byte-exact target output.
- `generic-stdio-pipe-product-marker` proves modeled stdio pipe productPath selection only with exact live-capture metadata, support proof `generic-finite-pipe-buffer-replay`, refusal proof `generic-pipe-stdio-refusals`, target output evidence, and `refusalClasses=[]`.
- `generic-multi-process-pipe-refusals` keeps missing peers, fan-in/fan-out, nonblocking endpoints, hidden shell pipeline state, PTY/inherited stdio, stale executable/cwd, and active partial writes fail-closed.
- `generic-process-tree-refusals` keeps service-managed children, dynamic worker pools, active requests, reload races, and non-exact process trees refused until exact process-tree reconstruction is modeled.

Remaining contract:

- graduate fan-in/fan-out or cycles only with their own complete graph and scheduler policy;
- model nonblocking/readiness semantics before accepting nonblocking endpoints;
- model shell/session state explicitly before accepting shell pipeline wrappers;
- keep service process-tree support separate from process-tree refusals until target-native worker/process lifecycle reconstruction has a happy-path proof.

## 2. PTY and terminal state

Current status:

- `generic-pty-transcript-probe` is the only PTY support shape: a proof-marked noninteractive command is reexeced target-natively under a PTY, with captured termios/winsize/session/process-group evidence and transcript capture. It is not interactive terminal migration.
- `generic-pty-terminal-refusals` records PTY fd/path evidence in the generic descriptor and keeps every unsupported interactive/ambiguous PTY shape fail-closed with no target pid.
- The descriptor can carry termios, winsize, session/process-group, foreground process-group, tty number, and fd flags when preflight exposes them; if those probes are unavailable, the descriptor records the gap and still refuses.
- This is **not** interactive terminal migration and does not replay live user/session state.

Required contract before support:

- define a noninteractive transcript/probe-only PTY contract with an explicit transcript policy;
- define whether the loader uses `script`, a brokered PTY, or an explicit terminal emulator boundary;
- prove target-visible terminal evidence without claiming interactive session teleportation;
- refuse dirty editor state, alternate screen state, job-control state, foreground-pgrp ambiguity, unknown termios, and unknown/unsupported window-size transitions until modeled.

## 3. Unix domain sockets

Wave 2 baseline refusal evidence now exists for:

- pathname Unix socket listeners;
- abstract namespace listeners;
- datagram sockets;
- socketpairs;
- connected streams.

This is refusal-only. No Unix socket support is graduated by the baseline.

Required contract to graduate support:

- distinguish pathname, abstract namespace, socketpair, datagram, and stream sockets;
- capture peer identity, credentials, pending accept/connect state, socket options, and filesystem pathname identity;
- prove target-native reconstruction only for idle/listener shapes first;
- refuse connected streams, passed fds, credential-sensitive sockets, and abstract namespace sockets until modeled.

## 4. Regular-file cursor frontier

Graduated narrow support:

- read-only regular-file fd cursors are supported when capture records fd number, resolved path, source dev/inode evidence, access flags, offset, size, mtime, and sha256;
- target loader validates portable target identity (`size`, `sha256`), opens each file read-only, seeks to the captured offset, `dup2`s it to the captured fd number, then execs target-native argv;
- source dev/inode and mtime are descriptor evidence only. They are not compared across source/target VMs because separate target filesystems legitimately have different inode and timestamp identities for equivalent content.

Graduated narrow append support:

- append-only log fd continuation is supported only for exact `O_APPEND` regular-file descriptors captured at EOF. The descriptor records fd number, path, flags, source dev/inode/mtime evidence, offset, size, sha256, `access: append-only`, and `cursor.policy: append-only-end`;
- target loader preflight validates portable target identity with `size` and `sha256` before launch. Stale, truncated, rotated, or missing target logs refuse with `targetPid=null`;
- target loader opens the file with `O_WRONLY|O_APPEND|O_NOFOLLOW`, `dup2`s it to the captured fd, then execs target-native argv. Support rows require visible target append progress after load.

Remaining frontier:

- append candidates not captured at EOF, append fds with unsupported flags such as truncate, log rotation/reconciliation, concurrent writer ambiguity, mmap dirty state, file-lock reconstruction, and inotify/fanotify follow semantics remain refused;
- writable non-append file cursors are refused as `writableRegularFileCursor`;
- deleted/unlinked regular-file fds are refused as `regularFileDeleted`;
- nonseekable file-like resources remain refused through their resource class.

## 5. File locks

Current status:

- generic preflight attempts runtime evidence from `/proc/<pid>/fdinfo/*`, `/proc/locks`, and a nonblocking lock probe against observed regular files;
- `generic-file-lock-advisory` proves proof-only target-native reacquisition of one exact flock whole-file advisory lock before launch, with path/file identity, owner policy, and a target conflict probe;
- `generic-file-lock-refusals` covers lock conflicts, changed backing files, unknown owners, mandatory locks, leases, invalid/nonseekable ranges, unsupported POSIX/OFD types, and cross-process ownership ambiguity with targetPid=null or no loader start;
- `generic-file-lock-refusal` remains descriptor-level harness refusal evidence for legacy unsafe lock detection because advisory lock visibility is kernel/filesystem dependent in the current guest proof path.

Required contract to graduate:

- capture advisory/flock/POSIX/OFD locks, byte ranges, owner identity, and conflict policy;
- prove target-side lock acquisition before launch and exact refusal on conflict;
- refuse mandatory locks, leases, unknown lock owners, nonseekable offsets, POSIX/OFD variants, and cross-process ownership ambiguity until modeled.

## 6. Epoll/readiness and anon inodes

Required contract:

Wave 2 baseline refusal evidence now distinguishes eventfd, epoll/eventpoll, timerfd, signalfd, inotify, fanotify, io_uring, and unknown anon-inode state where observed. Wave 3 adds refusal-preserving descriptor evidence for eventfd counters, epoll watched-fd metadata/trigger mode/one-shot bit/watched class, timerfd clock/deadline/interval fields, and one proof-only inotify file-follow shape. Tiny eventfd/epoll/timerfd/inotify shapes now graduate separately: one normal-flag eventfd with a modeled counter, one normal-flag epoll set with a level-trigger/no-one-shot watch on that supported eventfd, one normal-flag epoll set with a level-trigger/no-one-shot watch on the supported timerfd, one normal-flag `CLOCK_MONOTONIC` relative one-shot timerfd with zero interval and no unread ticks, and one `IN_MODIFY` inotify watch on a stable regular file with future-event-only policy. `generic-epoll-eventfd-watch-refusals` keeps active waiters/runtime loops, unknown watched fds, edge-trigger state, one-shot state, nested epoll, unsupported flags, and incompatible counters fail-closed. `generic-inotify-fanotify-refusals` keeps queued inotify event replay, dropped/overflow state, recursive watches, directory mutation races, changed watched identity, fanotify permission events, and unsupported watcher masks fail-closed. Aliases, realtime/absolute/periodic timers, unread timer expirations, and broad watcher migration remain refused.

Required contract to graduate support:

- classify epoll, eventfd, timerfd, signalfd, inotify, fanotify, pidfd, and io_uring separately;
- capture watched fd graph, event masks, one-shot/edge-trigger state, counters, and readiness policy;
- prove a minimal eventfd/epoll reconstruction before accepting any anon inode;
- refuse unknown anon inodes and watched unsupported fds with exact evidence.

## 7. Timers and signals

Required contract:

- capture interval timers, POSIX timers, timerfd state, pending signals, masks, dispositions, and process group semantics;
- define target-time translation rules and monotonic/realtime clock policy;
- prove timer restart with bounded skew and visible target evidence (currently covered only for one `CLOCK_MONOTONIC` relative one-shot timerfd row);
- refuse pending signal delivery, ambiguous process groups, unknown handlers, signalfd queues, and runtime-managed signal timers until modeled. The `generic-signalfd-signal-state-refusals` row is refusal-only evidence: it records signal masks/dispositions separately and does not reconstruct signal delivery.

## 8. mmap-backed files

Current status:

- `generic-mmap-file-backed-clean` proves one proof-only clean file-backed mapping with path, offset, length, permissions, sharing, and sha256 identity preflight, reconstructed target-natively with mapped bytes visible in the loader log;
- `generic-mmap-dirty-refusals` keeps dirty MAP_SHARED/MAP_PRIVATE, anonymous dirty memory, writable/executable mapping hazards, truncation races, and changed backing files fail-closed with targetPid=null or no loader start;
- writable or dirty file-backed mappings are still refused as `mmapFile` when they match captured regular-file fd paths;
- no dirty range materialization, anonymous mapping replay, writable executable mapping support, truncation repair, changed backing-file repair, or arbitrary MAP_SHARED/MAP_PRIVATE reconstruction is claimed.

Required contract:

- capture file-backed mappings, dirty ranges, MAP_SHARED/MAP_PRIVATE policy, permissions, offsets, and truncation identity;
- prove target file identity and dirty-range materialization before process launch;
- refuse anonymous dirty memory, executable writable mappings, and changed backing files until modeled.

## 9. Database/data-dir safety

Current status:

- `generic-service-redis-idle-parity` proves one exact empty/no-persistence Redis dataset shape with target-native generic reexec, loopback idle listener, `DBSIZE=0`, and PING/DBSIZE health;
- `generic-database-data-dir-refusals` keeps WAL/checkpoint ambiguity, active writers, database locks, non-empty persistence without modeled semantics, dirty checkpoints, target owner/mode drift, symlink hazards, and service-specific features fail-closed with no target pid;
- no non-empty database state, WAL replay, checkpoint repair, persistence migration, active session migration, owner/mode repair, or broad database migration is claimed.

Required contract:

- capture quiescence, tree identity, ownership/mode, lock/WAL/checkpoint evidence, and database-specific feature gates;
- prove target-native restart and health only for an exact modeled database/data-dir shape;
- refuse every unmodeled persistence, recovery, ownership, symlink, lock, and service-specific feature boundary.

## 10. Same-arch continuation

Current status:

- `generic-same-arch-modeled-continuation` is a proof-only single-thread same-architecture native-code harness: source/target architectures match, one frozen thread has modeled registers, stack, executable memory bytes, stdio-only fd compatibility, all observed resource classes modeled, and target-native code returns the expected value without source-ISA emulation;
- `generic-same-arch-continuation-refusals` keeps unsafe same-arch states fail-closed: active syscalls, multiple threads without a proven scheduler model, unsupported mappings, runtime heap assumptions, unsupported signal state, unsupported fds, and resource graph gaps all refuse before target launch;
- this is not arbitrary process restore, runtime heap migration, active syscall continuation, multi-thread scheduling, or product support.

Required contract:

- require a safe boundary, frozen threads, register state, stack/memory mappings, fd graph, and signal state;
- support same-architecture continuation only after resource graph support is complete for all observed resources;
- prove target resumes native code without source-ISA emulation;
- refuse active syscalls, multiple threads without a proven scheduler model, unsupported mappings, and runtime heap assumptions.

## 11. Cross-arch semantic reconstruction

Current status:

- `generic-cross-arch-semantic-reconstruction` is a proof-only finite byte-stream semantic reconstruction row: the descriptor source architecture differs from the target architecture, contains no source registers/source ISA state, models the exact transform semantically, and target-visible output is produced by `/usr/bin/python3` on the target architecture;
- `generic-cross-arch-semantic-refusals` keeps unsafe cross-architecture claims fail-closed: metadata-only success, source-ISA emulation, runtime-profile shortcuts, arbitrary ELF/process claims, unsupported resources, missing target-native binaries, and incomplete dependency graphs all refuse before target-native launch;
- this is not arbitrary ELF/process restore, source-ISA execution, metadata-only success, runtime heap/profile migration, or product support.

Required contract:

- reconstruct behavior from semantic descriptors rather than source registers or source-ISA execution;
- prove target-native binaries or proof-provisioned target-native binaries perform the continuation;
- require resource-class descriptors for every observed dependency;
- refuse metadata-only success, source-ISA emulation, runtime-profile shortcuts, and arbitrary ELF/process claims.

## Final full-expansion boundary

The full expansion remains exact target-native resource graph support only. It has support rows for a sequence of exact shapes and refusal rows for unsafe variants; it is not a general process checkpoint/restore system.

Non-claims that every status update, PR, and product note must preserve:

- no arbitrary process restore;
- no broad daemon/database migration;
- no active session migration;
- no source-fd teleportation;
- no source-ISA emulation;
- no metadata-only success.

Same-architecture continuation stays proof-only for one single-thread modeled native-code harness. Cross-architecture reconstruction stays semantic-descriptor based with target-native tools only. A row may graduate only when every observed resource class is modeled or refused with evidence, and unsafe variants fail closed before target launch or with `targetPid=null`.

## Graduation rule

A frontier class graduates only when all of these exist in the same change set:

1. public descriptor fields or an explicitly private proof descriptor;
2. capture/classifier support with exact refused evidence;
3. target loader/preflight strategy;
4. happy-path matrix proof with visible target evidence;
5. refusal matrix proof for stale/unsupported/unsafe cases;
6. coverage inventory update;
7. documentation update that states non-goals and refusal boundaries.
