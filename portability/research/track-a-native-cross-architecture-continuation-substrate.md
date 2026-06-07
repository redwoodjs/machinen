# Track A: Native cross-architecture continuation substrate

Researchers may use `192.168.0.8` as the shared research host for this track when they need a common machine for cross-architecture capture, restore, verification, or retained evidence.

## Worktree

Create and use a dedicated git worktree for this track before starting implementation or retained-evidence work:

```sh
git worktree add ../machinen-track-a-native-continuation -b research/track-a-native-continuation
```

## Goal

> Continue selected native code across `arm64 <-> amd64` at declared safe points.

## Implemented lanes

The first retained Track A lane is implemented in [`cross-arch-native-safepoint-scalar/`](cross-arch-native-safepoint-scalar/). It captures scalar state on one architecture, restores through a target-native C fixture on the other architecture, proves both directions, and keeps refusal evidence for unsupported state.

The useful CPU/memory lane is implemented in [`cross-arch-native-cpu-memory-final-jump/`](cross-arch-native-cpu-memory-final-jump/). It captures source `pc`, `sp`, and argument-register state, captures declared heap bytes, relocates a source pointer into target memory, builds target heap/stack/register state, and uses assembly to jump into target-native code in both directions.

The native binary proof/detection/refusal/support matrix is in [`native-binary-refusals/`](native-binary-refusals/). It tracks simple binary shapes through refused, proved fixture, classified candidate, detectable proved shape, and supported subset stages. A fixture proof alone is not support; support requires retained bidirectional proof, detection, and fail-closed refusal coverage. Ninety-three rows are now `4-supported-subset`, each limited to its detector-defined safe-point shape. This includes the known debug/marker-symbol real `/usr/bin/less` ready-outside-syscall subset, the unmodified system `/usr/bin/less` blocked-read `SPACE` subset, a wider unmodified less key-matrix subset, and pager/watcher ladders covering `more`, package-extracted `most`, `man printf`, `git log --paginate`, `tail -f`, stateful pager/search cases, real `man git-log` docs, tail truncation/rotation/multiple-file events, `sleep` timer/signal wakeup, finite pipelines, pipe-to-pager continuations, generated-repo `git log | less`, signal-forwarding supervisors, live-socket refusal, controlled socket descriptor reconstruction with explicit in-flight/queued/unclassified socket refusals, a ten-axis resource-state batch covering files, pipes, signals, timers, cwd, env/argv, mmap, threads, process identity, and terminals, a crazy-binary stress batch covering editors, REPLs, SQLite, curl, make, TUIs, tar/find/rsync, OpenSSL transforms, less-level live safe points for vi/nano/python/sqlite/make/top/watch/find, partial-stream/live-session/ptrace/debugger refusals, a shared native-continuation shape matrix with generic evidence gates plus procfs detector probes, an arbitrary-PID native continuation classifier that emits shape IDs from `/proc` observations, a capture descriptor contract requiring accepted classifier rows to carry architecture-neutral CPU/memory/resource/materializer descriptors while refusals carry none, a refusal-reduction batch for pipes, sockets, parked threads, stream boundaries, and paused-VM observations, a descriptor materializer proof for target-native reconstruction of accepted pty/pipe/socket/thread/stream-boundary shapes, a capture-to-materialize proof where real classifier descriptors are copied unchanged into target materializers, an experimental classify/capture/materialize CLI proof for accepted shapes, a real Node.js/PostgreSQL/Redis application-runtime ladder, first-class app adapters, schema validation, and a product-shaped experimental native CLI contract. One `pg` row remains refused because the binary is not installed/available on the retained research hosts. The marker harness captures source and target marker PCs with `ptrace`; the unmodified less harness combines strict blocked-read inference, marker/unmodified behavioral equivalence, and bidirectional cross-arch descriptor continuation. Real pager/watcher support remains narrow: controlled pty or deterministic watched regular file, listed keys/events only, descriptor materialization only, and no raw heap/stack/register restore.

## Initial constraints

- declared safe point only
- source and target binaries are both available
- no active syscall
- no threads
- no sockets
- no native runtime opacity
- no same PID guarantee
- regular files only after the scalar proof works

## 1. Define Continuation IR

The Continuation IR should be architecture-neutral and explicit:

- source architecture
- target architecture
- safe-point ID
- target re-entry symbol
- scalar locals
- stack-frame descriptors, once supported
- declared heap regions
- pointer relocation table, once supported
- resource descriptors, once supported
- claim guards proving no arbitrary-process or emulation claim

Example:

```json
{
  "kind": "machinen.research.continuation-ir",
  "version": 1,
  "sourceArch": "arm64",
  "targetArch": "amd64",
  "safePoint": "after_increment",
  "entrySymbol": "continue_from_safepoint",
  "state": {
    "counter": 41,
    "message": "hello"
  },
  "claimGuard": {
    "arbitraryProcessRestoreClaimed": false,
    "rawVmReplayUsed": false,
    "sourceIsaEmulationUsed": false,
    "metadataOnlySuccess": false
  }
}
```

## 2. Start with tiny native fixtures

First fixture should avoid runtime complexity:

```c
struct State {
  int counter;
  char message[64];
};

int continue_from_safepoint(struct State* state) {
  state->counter += 1;
  printf("%s:%d\n", state->message, state->counter);
  return state->counter;
}
```

Capture on one architecture records semantic/scalar state at the safe point. Restore on the other architecture compiles/uses the target-native fixture, loads the IR, calls `continue_from_safepoint`, and verifies output such as `hello:42`.

This is intentionally simple. It proves the harness and claim boundaries before attempting stack/register translation.

## 3. Add features rung by rung

Suggested ladder:

1. scalar locals only
2. declared heap structs
3. arrays and nested structs
4. pointer relocation inside declared regions
5. nested target re-entry frames
6. stack-frame descriptors
7. regular file descriptor offset preservation
8. pipes/eventfd/timerfd, only if resource semantics are proven
9. safe libc boundary calls
10. small event-loop fixture

Every rung must have:

- retained source capture
- retained target restore
- `arm64 -> amd64` proof
- `amd64 -> arm64` proof
- explicit refusal cases for unsupported state

## Related implementation lanes

- [Lane 1: Native scalar safe-point E2E](README.md#lane-1-native-scalar-safe-point-e2e)
- [Lane 2: Native heap/pointer safe-point E2E](README.md#lane-2-native-heappointer-safe-point-e2e)
- [Lane 3: Native regular-file resource E2E](README.md#lane-3-native-regular-file-resource-e2e)
- [Lane 4: Refusal hardening E2E](README.md#lane-4-refusal-hardening-e2e)
