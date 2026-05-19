# Portable snapshot bundle format

Experimental portable snapshots are semantic process bundles, not exact VM
state. They are intentionally separate from CRIU image bundles and
`state.vmstate` bundles.

Bundle layout:

```text
portable-snapshot/
  manifest.json
  memory.bin
  objects.json
  relocations.json
  resources.json
  logs/
```

The TypeScript source of truth for the JSON schemas and validator is
`packages/runtime/src/vm/portable-snapshot.ts`.

## Required manifest fields

`manifest.json` records:

- `formatVersion` (currently `1`)
- `sourceGuestArch` (`arm64` or `amd64`)
- `allowedTargetGuestArchs`
- program identity (`program.name`, `program.executable`, optional `identity`)
- source build identity (`sourceBuild.buildId`, optional `version`)
- required target build (`targetBuild.buildId` or `targetBuild.version`)
- cooperative checkpoint ABI (`checkpointAbi.version`, `machinen_checkpoint`,
  `machinen_checkpoint_roots`, and safe-point requirements)
- checkpoint continuation symbol (`checkpointContinuation.name`)
- restore entrypoint symbol (`restoreEntrypoint.name`, currently
  `machinen_restore_main`)
- process argv/env/cwd (`process`)
- feature flags (`features`)
- diagnostics vocabulary (`unsupported.refusals`)

`objects.json` records globals and heap allocations separately. Heap objects may
include allocator metadata (`allocation.id`, `allocation.sourceAddress`) plus a
`memory` range pointing at their raw bytes inside `memory.bin`. `relocations.json`
records pointer fields as source object + offset + source pointer, so restore can
translate source addresses into target addresses. The proof restore loader
(`/usr/local/bin/machinen-portable-restore-proof`) validates the bundle, copies
raw bytes into the target proof process, applies the known pointer relocations,
and calls `machinen_restore_main`. The first proof uses a fixed instrumented
allocator and refuses roots or pointer fields outside declared globals or live
allocations.

The proof ABI requires checkpoint requests to happen at a named cooperative
safe point, outside signal handlers and outside in-flight syscalls. The bundle
records the continuation name instead of raw source registers or stack frames.
Checkpoint refusals use stable diagnostic codes such as
`checkpoint-inside-syscall`, `checkpoint-inside-signal-handler`,
`checkpoint-invalid-roots`, `checkpoint-unknown-root`, and
`pointer-outside-known-object`.

The engine selector is opt-in via `MACHINEN_SNAPSHOT_ENGINE=portable`.
Until the checkpoint implementation lands, snapshot/restore fail with an
explicit experimental/unsupported-workload error.
