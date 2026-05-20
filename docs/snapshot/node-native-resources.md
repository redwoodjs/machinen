# Node native resources and refusals

Issue #434 adds resource capture to the cooperative Node runtime adapter.

The adapter separates **portable recipes** from **native handles that must refuse**.

## Captured recipes

The initial deterministic recipes are:

- `argv`
- `env`
- `cwd`
- regular file metadata: path, flags, and offset

`restoreNodeCapturedResourceRecipes()` replays those recipes into plain metadata for the target adapter. It does not reopen unsafe host resources by itself.

## Native handle refusals

The adapter can report stdio and arbitrary native handles as stable refusals. Current refusal examples:

- stdio/file descriptors: `fd-kind-unsupported`
- sockets, workers, PTYs, fs watchers: `resource-unsupported`
- timers/event-loop queues: `runtime-heap-unsupported`

These refusals are copied into `RuntimeAdapterDocument.resources.unsupported` and into the top-level restore decision. If any native handle is refused, semantic graph data may still exist, but the document says full replay is not safe yet.

## Why this shape

Node handles are host capabilities, not portable JavaScript values. A socket needs rebinding, a PTY needs host-side recreation, workers need thread handoff metadata, and timers need async continuation state. Recording the exact missing recipe is more useful than trying to serialize runtime internals.
