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
- checkpoint continuation symbol (`checkpointContinuation.name`)
- restore entrypoint symbol (`restoreEntrypoint.name`)
- process argv/env/cwd (`process`)
- feature flags (`features`)
- diagnostics vocabulary (`unsupported.refusals`)

The engine selector is opt-in via `MACHINEN_SNAPSHOT_ENGINE=portable`.
Until the checkpoint implementation lands, snapshot/restore fail with an
explicit experimental/unsupported-workload error.
