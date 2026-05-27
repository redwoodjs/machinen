# Goal 50: Clean-service kernel-state support-or-refusal proofs

Parent context: Goal 49 productized the generic clean-service snapshot/restore
path for narrow Node/Python/Go HTTP service subsets. Goal 50 strengthens that
claim by proving more kernel-level state is either inside the accepted clean
service model or refused before Machinen reports a portable restore path.

This goal should make the product safer without pretending Machinen can move
arbitrary kernel objects, live sessions, process graphs, VM memory, or runtime
private scheduler/interpreter state across architectures.

## Objective

Add shared clean-service kernel-state inspection, support, and refusal proofs.
Snapshot inspection should use a shared `/proc` scanner module where practical,
normalize product refusal codes under clean-service categories, and distinguish
three outcomes for each kernel-state class:

1. **Supported/resolved** — the state is safely modeled, reconstructed, rebound,
   closed, drained, or otherwise made irrelevant to the target-native service.
2. **Proven irrelevant** — the state exists but is outside the service's required
   continuation boundary and is safe to drop with a documented proof.
3. **Refused** — the state is required, ambiguous, dirty, or unsafe, so
   `machinen snapshot` fails closed with a product-visible refusal.

Add tests plus at least one smoke that creates unsafe kernel state and proves the
right support-or-refusal result.

A good PR title for this work is:

> Add clean-service kernel-state support-or-refusal proofs

## Scope

- [ ] Add a shared `/proc` scanner module for clean-service adapters.
- [ ] Add a per-resource decision model: `supported`, `irrelevant`, or `refused`.
- [ ] Add tests for fd/socket/mmap/process-group support-or-refusal behavior.
- [ ] Normalize new product refusal codes to stable clean-service categories.
- [ ] Add one smoke that creates unsafe kernel state and proves snapshot either
      resolves/proves it safe or refuses it.

## Required kernel-state support-or-refusal coverage

### Open file descriptors

- [ ] Support/prove safe read-only regular files inside the captured app root by
      capturing their bytes and verifying digests.
- [ ] Support/prove safe regular files outside the app root only when they are
      explicitly declared immutable inputs with digest/provenance; otherwise
      refuse them.
- [ ] Resolve/prove safe deleted-but-open files only when they are anonymous temp
      files that are not part of future service behavior; otherwise refuse them.
- [ ] Support/prove safe pipes/FIFOs/socketpairs only when they are startup-only
      or explicitly modeled; otherwise refuse them.

### Network state

Active TCP is already covered at adapter level. Strengthen this with kernel-level
proofs for:

- [ ] `ESTABLISHED` TCP sockets: support only if the service contract explicitly
      drains/closes them before capture and proves no request is in flight;
      otherwise refuse.
- [ ] `CLOSE_WAIT` TCP sockets: support only if they can be safely closed and the
      verifier still passes; otherwise refuse.
- [ ] Unix domain sockets: support only for explicitly modeled local control
      sockets that can be rebound on target; otherwise refuse.
- [ ] Listening sockets on unexpected ports: support only if declared as part of
      the component verifier/port model; otherwise refuse.
- [ ] TLS/websocket active streams: support only if the stream is application
      drained/closed before capture and reconnection semantics are documented;
      otherwise refuse as product-visible active-session state.

### `epoll` / `poll` / `eventfd`

- [ ] Detect service processes holding `epoll` fds.
- [ ] Support epoll only when every watched fd is part of the clean HTTP listener
      model and can be recreated by restarting the target-native service.
- [ ] Refuse epoll when watched fds include unmodeled sockets, pipes, eventfds,
      timerfds, signalfds, or files.
- [ ] Support/prove safe `eventfd` only when it belongs to runtime startup state
      recreated by target-native process start; otherwise refuse.
- [ ] Use these checks to guard async runtimes more safely.

### `timerfd` / `signalfd`

- [ ] Support `timerfd` only when the timer is recreated by normal application
      startup and no remaining deadline/state must carry across restore.
- [ ] Refuse `timerfd` state when replay rules or deadline semantics are needed.
- [ ] Support `signalfd` only when it is recreated by runtime startup and no
      pending signal state must be preserved.
- [ ] Refuse pending signal state when it is observable and unmodeled.

### `mmap` / shared memory

- [ ] Support/prove safe private read-only mappings backed by captured immutable
      app/runtime files.
- [ ] Support writable private anonymous mappings only as runtime-private state
      recreated by target-native process start, not as migrated continuation.
- [ ] Refuse writable shared mappings unless an explicit shared-memory model is
      implemented.
- [ ] Refuse SysV shared memory unless an explicit descriptor/recreate model is
      implemented.
- [ ] Refuse POSIX shared memory unless an explicit descriptor/recreate model is
      implemented.
- [ ] Refuse mmapped database/WAL files unless a service-specific logical capture
      path proves consistency.

### Process topology

- [ ] Strengthen multi-process decisions using `/proc/*/stat`.
- [ ] Support exactly one primary service process by default.
- [ ] Support child workers only when an explicit process-group model captures
      membership, startup order, verifier coverage, and failure semantics.
- [ ] Refuse orphan helper processes tied to the service unless explicitly
      modeled.
- [ ] Refuse shared process groups unless an explicit process-group model exists.
- [ ] Refuse unexpected sessions/session leaders tied to the service.

### Namespace / mount state

- [ ] Support app cwd/root on normal captured guest filesystem paths.
- [ ] Support host mounts only when mounted read-only and every referenced file is
      captured or declared immutable with digest/provenance.
- [ ] Refuse app cwd/root on writable host mounts.
- [ ] Refuse unexpected bind mounts visible in `/proc/<pid>/mountinfo` unless
      declared and proven immutable.
- [ ] Refuse dirty mount-backed state.

### Native/runtime boundary

- [ ] For Go, prove static binary status via ELF headers, not just `strings`.
- [ ] For Go, support static binaries with no dynamic interpreter and no cgo
      dependency that must carry runtime-private state.
- [ ] For Go, refuse cgo/dynamic linkage with stable clean-service codes unless
      an explicit native dependency provenance model is added.
- [ ] For Node/Python, inspect loaded shared libraries from `/proc/<pid>/maps`.
- [ ] Support expected distro/runtime shared libraries when they are provided by
      the target runtime policy.
- [ ] Refuse unmodeled native addon / C-extension / shared-library state with
      normalized clean-service categories.

## Refusal vocabulary

New runtime-specific detections may keep adapter-specific detail for debugging,
but product-visible codes must map to stable clean-service categories such as:

- `clean-service-open-fd-unsupported`
- `clean-service-deleted-open-file-unsupported`
- `clean-service-active-session-unsupported`
- `clean-service-unix-socket-unsupported`
- `clean-service-unexpected-listener-unsupported`
- `clean-service-epoll-state-unsupported`
- `clean-service-eventfd-state-unsupported`
- `clean-service-timerfd-state-unsupported`
- `clean-service-signalfd-state-unsupported`
- `clean-service-shared-memory-unsupported`
- `clean-service-mmapped-durable-state-unsupported`
- `clean-service-process-topology-unsupported`
- `clean-service-mount-state-ambiguous`
- `clean-service-native-extension-state-unsupported`

## Support bar

A kernel-state class may move from refusal to support only when the PR includes:

- a precise descriptor/recreate/close/drain rule;
- a proof that the target-native verifier covers the behavior users care about;
- a negative test showing ambiguous or dirty variants still refuse;
- manifest/summary fields that explain what was supported or intentionally
  dropped;
- docs with user remediation when the support rule is not satisfied.

`resolved` must not mean "ignored". It must mean the state was either recreated,
closed/drained with verifier proof, captured with integrity/provenance, or proven
irrelevant to the clean-service continuation boundary.

## Non-goals

This goal does **not** add support for preserving arbitrary kernel state. It does
not claim support for active websocket/TLS session migration, arbitrary Unix
socket graphs, epoll replay, timer replay, pending signal replay, shared-memory
migration, database/WAL byte-copy, process groups, native extension state, or Go
scheduler/runtime-private state unless a future explicit support model meets the
support bar above.

The goal is to support the safe subset and make all remaining unsafe state
product-visible and fail-closed.

## Required tests

- [ ] Unit tests for the shared `/proc` scanner using fixture `/proc` trees or
      isolated parser fixtures.
- [ ] Decision tests for `supported`, `irrelevant`, and `refused` outcomes.
- [ ] Adapter-level tests proving Node/Python/Go map scanner findings to stable
      clean-service support or refusal categories.
- [ ] Manifest/summary tests proving supported/resolved resources are recorded.
- [ ] Manifest/summary tests proving machine-readable refusal output includes
      `migrationCompleted=false` and the expected product refusal code.
- [ ] Multi-component tests proving unsafe secondary components are not silently
      ignored.

## Required smoke

Add one product smoke that:

1. boots a clean-service VM;
2. creates representative kernel state;
3. runs `machinen snapshot <vm> <bundle>`;
4. proves supported/resolved state is recorded and verifier-covered, or proves
   unsafe state fails closed;
5. asserts the product-visible support/refusal code is normalized under
   clean-service categories.

The smoke should prefer a small matrix over a huge end-to-end suite. It should
include at least one positive resolved/supported case and one negative refusal
case if runtime cost stays reasonable.

## Documentation

- [ ] Update clean-service docs with the kernel-state support-or-refusal model.
- [ ] Add user remediation examples for each major class: - close or drain active connections; - stop workers and helper processes; - move app roots off writable host mounts; - close deleted temp files; - avoid mmapped DB/WAL state in clean-service restore; - rebuild native/Go artifacts with explicit static/provenance policy.

## Validation

Run and record timing for:

- [ ] `pnpm run format:check`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] targeted Vitest files for the `/proc` scanner, adapter refusal mapping, and
      manifest/summary behavior;
- [ ] the new clean-service kernel-state support-or-refusal smoke;
- [ ] `pnpm exec fallow audit --changed-since origin/main`

Run broader clean-service product smokes if the implementation changes snapshot
or restore behavior beyond refusal detection.
