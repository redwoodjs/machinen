# Generic resource graph graduation frontier

This document lists follow-up contracts for resource classes that are **not** implicitly supported by the generic resource graph pilot. Each class must get its own descriptor shape, loader/preflight strategy, refusal evidence, and matrix proof rows before it can move from `refused` or `deferred` to `supported`.

## 1. Stdio and pipes

Required contract:

- classify stdin/stdout/stderr separately from anonymous pipe graph edges;
- preserve pipe direction, producer/consumer process graph, close-on-exec flags, nonblocking flags, and buffered partial data policy;
- prove no hidden shell pipeline state is accepted without a complete graph;
- add support rows for finite pipe replay and long-running producer/consumer continuation;
- add refusal rows for missing peer, active partial write, unsupported fan-in/fan-out, and nontrivial inherited stdio.

## 2. PTY and terminal state

Required contract:

- capture controlling terminal, session/process group, termios, winsize, foreground process group, and transcript policy;
- define whether the loader uses `script`, a brokered PTY, or an explicit terminal emulator boundary;
- prove target-visible terminal evidence without claiming interactive session teleportation;
- refuse dirty editor state, alternate screen state, and unknown terminal modes until modeled.

## 3. Unix domain sockets

Required contract:

- distinguish pathname, abstract namespace, socketpair, datagram, and stream sockets;
- capture peer identity, credentials, pending accept/connect state, socket options, and filesystem pathname identity;
- prove target-native reconstruction only for idle/listener shapes first;
- refuse connected streams, passed fds, credential-sensitive sockets, and abstract namespace sockets until modeled.

## 4. File locks and offsets

Required contract:

- capture advisory/flock/POSIX/OFD locks, byte ranges, owner identity, and conflict policy;
- represent offsets per fd with read/write mode and seekability;
- prove target-side lock acquisition before launch and exact refusal on conflict;
- refuse mandatory locks, leases, unknown lock owners, and nonseekable offsets until modeled.

## 5. Epoll/readiness and anon inodes

Required contract:

- classify epoll, eventfd, timerfd, signalfd, inotify, fanotify, pidfd, and io_uring separately;
- capture watched fd graph, event masks, one-shot/edge-trigger state, counters, and readiness policy;
- prove a minimal eventfd/epoll reconstruction before accepting any anon inode;
- refuse unknown anon inodes and watched unsupported fds with exact evidence.

## 6. Timers and signals

Required contract:

- capture interval timers, POSIX timers, timerfd state, pending signals, masks, dispositions, and process group semantics;
- define target-time translation rules and monotonic/realtime clock policy;
- prove timer restart with bounded skew and visible target evidence;
- refuse pending signal delivery and runtime-managed timers until modeled.

## 7. mmap-backed files

Required contract:

- capture file-backed mappings, dirty ranges, MAP_SHARED/MAP_PRIVATE policy, permissions, offsets, and truncation identity;
- prove target file identity and dirty-range materialization before process launch;
- refuse anonymous dirty memory, executable writable mappings, and changed backing files until modeled.

## 8. Same-arch continuation

Required contract:

- require a safe boundary, frozen threads, register state, stack/memory mappings, fd graph, and signal state;
- support same-architecture continuation only after resource graph support is complete for all observed resources;
- prove target resumes native code without source-ISA emulation;
- refuse active syscalls, multiple threads without a proven scheduler model, unsupported mappings, and runtime heap assumptions.

## 9. Cross-arch semantic reconstruction

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
