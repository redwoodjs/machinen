# Native process capture proof

Issue #443 starts the transparent native path with an external Linux capturer.
The target process does not link against Machinen and does not call a checkpoint
function. The capturer stops it from the outside with `ptrace` and reads state
through `/proc`.

## Command

```sh
pnpm native-process-capture
```

On non-Linux hosts the proof reports a skip because `/proc/<pid>/mem` and
`ptrace` are required.

To keep the generated bundle:

```sh
pnpm native-process-capture -- --out-dir /tmp/native-capture --keep --json
```

Inspect:

```sh
ls /tmp/native-capture/bundle
cat /tmp/native-capture/bundle/native-process.json
cat /tmp/native-capture/bundle/native-threads.json
cat /tmp/native-capture/bundle/native-resources.json
```

## What the capturer records

The C helper in `packages/microvm/assets/native-process-capture.c` can either
attach to an existing PID or launch an unmodified command and then attach to the
child. The proof uses launch mode so Linux Yama `ptrace_scope=1` still allows the
parent capturer to trace the child.

The bundle records:

- process identity: `exe`, `argv`, `env`, `cwd`, and auxv bytes;
- memory maps from `/proc/<pid>/maps`;
- readable mapping bytes from `/proc/<pid>/mem` into `native-memory.bin`;
- per-thread stopped state and architecture-specific register documents;
- signal masks and TLS thread pointer metadata;
- fd table metadata, regular-file reopen recipes, and resource refusals for
  broker-required fd kinds;
- a pending `native-translation.json` plan.

## Proof target

`packages/microvm/assets/native-capture-target.c` is intentionally small and
non-cooperative. It opens a resource file, seeks to offset `9`, prints a startup
line, and spins in user space. It has no Machinen checkpoint ABI and never emits
a bundle. All capture work happens in the external capturer.

## Translation remains pending

This issue does not translate registers, stacks, code locations, or pointers.
Every captured thread is listed in `native-translation.json` with state
`pending`. Later issues translate or refuse that state:

- #445 registers/TLS/syscall state
- #446 code-location maps
- #447 stack continuations
- #448 memory relocation
- #449 kernel resources

## Refusal discipline

Readable mappings that cannot be read through `/proc/<pid>/mem` are emitted with
`mapping-unreadable`. Mappings that exceed the capture policy are emitted with
`mapping-ambiguous`. Non-regular fd kinds are emitted as resource refusals until
a broker recipe exists.
