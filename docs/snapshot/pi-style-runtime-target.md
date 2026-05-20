# pi-style runtime target proof

Issue #439 applies the runtime adapter stack to a small pi/Claude-Code-like Node target.

The fixture models an agent process with:

- transcript state
- shared session object identity
- a `Map` of tools
- active tool references
- resource handles that real agents use: stdio, PTY, sockets, and child processes
- a cooperative async continuation token for the next turn

The proof captures the state with the Node runtime adapter, records JavaScript build identity, writes `runtime-adapter.json` into a portable bundle, validates the bundle mapping, restores the semantic graph, and resumes the cooperative async continuation.

## What works

- Semantic agent graph restore.
- Shared object identity through Maps and active references.
- JS source/package/module identity check.
- Cooperative promise-style continuation restore.

## What still refuses

Full live process restore remains refused. Native handles report stable refusals:

- stdio: `fd-kind-unsupported`
- PTY/socket/child process handles: `resource-unsupported`

This is the intended result for now: pi-style targets can move explicit semantic state, but real live Claude Code/pi restore still needs host capability recipes and deeper runtime adapter support.

## Verify

```sh
pnpm pi-style-runtime-target
```
