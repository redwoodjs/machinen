# Generic resource graph graduation frontier

This document lists follow-up contracts for resource classes that are **not** implicitly supported by the generic resource graph pilot. Each class must get its own descriptor shape, loader/preflight strategy, refusal evidence, and matrix proof rows before it can move from `refused` or `deferred` to `supported`.

## 1. Stdio and pipes

Detailed contract: [`generic-pipes-stdio-graduation.md`](./generic-pipes-stdio-graduation.md).

Required contract:

- classify stdin/stdout/stderr separately from anonymous pipe graph edges;
- preserve pipe direction, producer/consumer process graph, close-on-exec flags, nonblocking flags, and buffered partial data policy;
- prove no hidden shell pipeline state is accepted without a complete graph;
- add support rows for finite pipe replay and long-running producer/consumer continuation;
- add refusal rows for missing peer, active partial write, unsupported fan-in/fan-out, and nontrivial inherited stdio.

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
- `generic-file-lock-refusal` remains descriptor-level harness refusal evidence for the matrix row because advisory lock visibility is kernel/filesystem dependent in the current guest proof path;
- this proves fail-closed behavior with no loader start. It is not lock reconstruction.

Required contract to graduate:

- capture advisory/flock/POSIX/OFD locks, byte ranges, owner identity, and conflict policy;
- prove target-side lock acquisition before launch and exact refusal on conflict;
- refuse mandatory locks, leases, unknown lock owners, and nonseekable offsets until modeled.

## 6. Epoll/readiness and anon inodes

Required contract:

Wave 2 baseline refusal evidence now distinguishes eventfd, epoll/eventpoll, timerfd, signalfd, inotify, fanotify, io_uring, and unknown anon-inode state where observed. Wave 3 adds refusal-preserving descriptor evidence for eventfd counters plus epoll watched-fd metadata, trigger mode, one-shot bit, and watched resource class. Tiny eventfd/epoll shapes now graduate separately: one normal-flag eventfd with a modeled counter, and one normal-flag epoll set with a level-trigger/no-one-shot watch on that supported eventfd. Active waiters/runtime loops, unknown watched fds, edge-trigger state, one-shot state, nested epoll, aliases, unsupported flags, and incompatible counters remain refused.

Required contract to graduate support:

- classify epoll, eventfd, timerfd, signalfd, inotify, fanotify, pidfd, and io_uring separately;
- capture watched fd graph, event masks, one-shot/edge-trigger state, counters, and readiness policy;
- prove a minimal eventfd/epoll reconstruction before accepting any anon inode;
- refuse unknown anon inodes and watched unsupported fds with exact evidence.

## 7. Timers and signals

Required contract:

- capture interval timers, POSIX timers, timerfd state, pending signals, masks, dispositions, and process group semantics;
- define target-time translation rules and monotonic/realtime clock policy;
- prove timer restart with bounded skew and visible target evidence;
- refuse pending signal delivery and runtime-managed timers until modeled.

## 8. mmap-backed files

Current status:

- writable file-backed mappings are refused as `mmapFile` when they match captured regular-file fd paths;
- this is refusal-only. No dirty range, MAP_SHARED, or MAP_PRIVATE reconstruction is claimed.

Required contract:

- capture file-backed mappings, dirty ranges, MAP_SHARED/MAP_PRIVATE policy, permissions, offsets, and truncation identity;
- prove target file identity and dirty-range materialization before process launch;
- refuse anonymous dirty memory, executable writable mappings, and changed backing files until modeled.

## 9. Same-arch continuation

Required contract:

- require a safe boundary, frozen threads, register state, stack/memory mappings, fd graph, and signal state;
- support same-architecture continuation only after resource graph support is complete for all observed resources;
- prove target resumes native code without source-ISA emulation;
- refuse active syscalls, multiple threads without a proven scheduler model, unsupported mappings, and runtime heap assumptions.

## 10. Cross-arch semantic reconstruction

Required contract:

- reconstruct behavior from semantic descriptors rather than source registers or source-ISA execution;
- prove target-native binaries or proof-provisioned target-native binaries perform the continuation;
- require resource-class descriptors for every observed dependency;
- refuse metadata-only success, source-ISA emulation, runtime-profile shortcuts, and arbitrary ELF/process claims.

## Graduation rule

A frontier class graduates only when all of these exist in the same change set:

1. public descriptor fields or an explicitly private proof descriptor;
2. capture/classifier support with exact refused evidence;
3. target loader/preflight strategy;
4. happy-path matrix proof with visible target evidence;
5. refusal matrix proof for stale/unsupported/unsafe cases;
6. coverage inventory update;
7. documentation update that states non-goals and refusal boundaries.
