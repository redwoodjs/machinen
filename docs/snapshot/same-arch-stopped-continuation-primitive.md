# Same-arch stopped continuation primitive

This contract defines the first narrow `machinen move` live-state continuation primitive. It is a same-architecture stopped single-thread safe-point contract. It is not a reexec route, not a restart route, and not resource reconstruction.

Machine-readable contract: [`same-arch-stopped-continuation-primitive-contract.json`](./same-arch-stopped-continuation-primitive-contract.json).

## Exact supported source shape

The only supported shape is:

- source architecture equals target architecture (`arm64 -> arm64` or `amd64 -> amd64`);
- exactly one thread;
- the source thread is stopped by a move-owned ptrace stop or equivalent freeze;
- the stop is at a user-mode instruction boundary;
- there is no active syscall, syscall restart, blocking kernel wait, or signal-delivery frame;
- the program counter is inside a verified executable/text mapping;
- target text bytes or build identity match the captured source text mapping;
- private writable memory, stack bytes, registers, flags/pstate, stack pointer, instruction pointer, and TLS pointer are captured;
- stdio is only closed, `/dev/null`, or explicitly move-owned inert stdio;
- no non-stdio fd, socket, pipe, eventfd, epoll, timerfd, inotify, signalfd, device, lock, PTY, controlling terminal, session, job-control, pending signal, non-default handler state, or alternate signal stack is required.

Anything outside that shape must refuse before target continuation.

## Captured live-state fields

The primitive must capture:

- process identity: pid, ppid, exe, argv, cwd, uid, gid;
- architecture and ABI: source arch, target arch, and ABI;
- thread state: thread id, stop reason, instruction pointer, stack pointer, general registers, flags/pstate, TLS pointer, and active syscall state;
- memory state: executable mappings, private writable mappings, stack mapping, permissions, offsets, build id or sha256, captured private bytes, and program-counter mapping id;
- resource state: fd table summary, stdio policy, signal state, timer state, socket state, session state, and unsupported resource refusals;
- integrity evidence: capture timestamp, source freeze evidence, target preflight identity evidence, and no-reexec guard evidence.

## Target continuation step

The target step must materialize target-native state and resume from the captured instruction pointer. It must not run the source argv as a fresh program.

Required target behavior:

1. create a target continuation container/process under move control without fresh argv startup;
2. verify target executable/text identity;
3. materialize captured private writable mappings and stack bytes;
4. install captured same-architecture registers and thread-local state;
5. verify no refused resource class appeared during target preflight;
6. resume at the captured instruction pointer;
7. report `targetPid` only after the resumed thread reaches the continuation success marker.

The success marker must depend on captured register or memory values so a fresh restart cannot satisfy the proof.

## Refusal classes

The first primitive refuses:

- architecture mismatch;
- multiple threads;
- missing move-owned stopped safe point;
- active syscall, syscall restart, or in-kernel wait state;
- target text/build identity mismatch;
- unproven program-counter provenance;
- unmodeled private memory, stack, or mapping state;
- shared, device, vvar, vdso, JIT, or ambiguous mappings;
- non-stdio fds;
- sockets or active sessions;
- timers and event-loop state;
- pending/caught/blocked signal state outside the modeled empty/default shape;
- PTY, controlling terminal, process-group, session, or job-control state;
- any path that would need reexec, restart, static-root reconstruction, output replay, descriptor-only equivalence, app export/import, source-ISA emulation, source-fd teleportation, or metadata-only success.

On refusal, no target process may remain running and successful `targetPid` must not be reported.

## Hard non-claims

This primitive does not claim:

- cross-architecture support;
- arbitrary process restore;
- any-binary movement;
- runtime heap migration;
- Node/V8, Python, JVM, Go, Rust, or native-addon runtime continuation;
- service, database, HTTP, socket-session, terminal, or active user session migration;
- fd/socket/timer/signal continuation outside the exact modeled empty resource shape;
- source-fd teleportation;
- source-ISA emulation;
- metadata-only success;
- product support before happy-path and refusal proofs are recorded.

## Required proofs

Before this can be product support, validation must prove:

1. a happy-path row resumes from captured live state and cannot be satisfied by fresh argv restart;
2. each refusal class fails closed;
3. no reexec, restart, target-original loader, generic-resource-graph reexec loader, static HTTP loader, file cursor loader, pipe replay loader, output replay, descriptor-only success, source-fd teleportation, or metadata-only success path is used;
4. no target process remains running after refusal;
5. docs/API and guardrails preserve the hard non-claims.
