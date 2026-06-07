# Native binary refusal matrix

This directory tracks simple native binary shapes we want to prove for Track A.

Rows move through these stages:

1. `1-refused` — default state; no support claim.
2. `2-proved-fixture` — a tiny fixture has retained bidirectional proof, but real binaries are still not supported.
3. `2-classified-unaccepted-shape` — a real process state has retained classifier evidence, but is intentionally not accepted yet.
4. `3-detectable-proved-shape` — a detector can prove a real binary fits the proved shape and refuse nearby unsafe state.
5. `4-supported-subset` — only the detected subset is supported.

A row can reach support only when it has:

1. retained source capture evidence
2. retained target restore evidence
3. `arm64 -> amd64` proof
4. `amd64 -> arm64` proof
5. detector/classifier coverage proving a real binary fits the shape
6. fail-closed refusal coverage for unsupported nearby state

The source file is `refusals.json`. Generate the machine-readable index and HTML dashboard with:

```sh
node portability/research/native-binary-refusals/build-index.mjs
```

Current supported subsets:

Ninety-three rows are at `4-supported-subset`. Each support claim is limited to the exact detector-defined safe-point shape, retained bidirectional proof, and retained fail-closed refusals for nearby unsafe state. One row remains `1-refused` because `pg` is not installed/available on the retained research hosts.

The real `/usr/bin/less` ready-outside-syscall row is a supported research subset for known debug/marker-symbol upstream less 643 only. The unmodified system `/usr/bin/less` blocked-read row is also a supported research subset after marker/unmodified behavioral equivalence and bidirectional cross-arch descriptor continuation evidence. Scope is narrow: controlled pty, regular file, first page rendered, blocked `read(fd)`, empty input queue, and descriptor materialization only. The unmodified key-matrix subset now supports `SPACE`, `b` as first-page no-op/no-redraw, `/line-050`, `/line-050` then `n` with isolated less history, `g` as first-page no-op/no-redraw, `G`, and `q`. The pager/watcher ladders add supported subsets for unmodified `more`, package-extracted `most`, `man printf` through a pager child, `git log --paginate` through a pager child, `tail -f` append observation, stateful `less`/`more` backward paging, `less`/`most` search-next state, default-pager wrappers, real `man git-log` docs, tail truncation/rotation/multiple-file events, `sleep` timer/signal wakeup, finite pipelines, pipe-to-pager continuations, generated-repo `git log | less`, signal-forwarding supervisors, a retained live-socket refusal, controlled empty/local socket descriptor reconstruction with explicit in-flight/queued/unclassified socket refusals, a ten-axis resource-state batch for files, pipes, signals, timers, cwd, env/argv, mmap, threads, process identity, and terminals, a crazy-binary stress batch covering editors, REPLs, SQLite, curl, make, TUIs, tar/find/rsync, OpenSSL transforms, less-level live safe points for vi/nano/python/sqlite/make/top/watch/find, partial-stream/live-session/ptrace/debugger refusals, a shared native-continuation shape matrix with generic same-arch/cross-arch/claim-guard gates plus procfs detector probes, an arbitrary-PID native continuation classifier that emits shape IDs from `/proc` observations, a capture descriptor contract requiring accepted classifier rows to carry architecture-neutral CPU/memory/resource/materializer descriptors while refusals carry none, a refusal-reduction batch for pipes, sockets, parked threads, stream boundaries, and paused-VM observations, a descriptor materializer proof for target-native reconstruction of accepted pty/pipe/socket/thread/stream-boundary shapes, a capture-to-materialize proof where real classifier descriptors are copied unchanged into target materializers, an experimental classify/capture/materialize CLI proof for accepted shapes, a real Node.js/PostgreSQL/Redis application-runtime ladder, first-class app adapters, schema validation, and a product-shaped experimental native CLI contract. The separate real `/usr/bin/less` blocked-read detector row remains at `3-detectable-proved-shape` for the marker detector's active-syscall shape until broader cross-architecture continuation evidence exists.

Generated files:

- `index.json`
- `index.html`
