# Machinen Local API v1

Machinen exposes its terminal and spatial scene over a same-user Unix domain
socket. It does not open a TCP port, HTTP endpoint, or custom URL scheme.

## Transport

The default socket is:

```text
/tmp/machinen-<uid>/api-v1.sock
```

`MACHINEN_API_SOCKET` overrides the path. The containing directory is mode
`0700`, the socket is mode `0600`, and Machinen rejects peers with another user
ID. Messages are UTF-8, newline-delimited JSON. A request may be at most 1 MiB.

A client must keep the connection open, send `system.hello` first, and match
responses by `id`. Subscribed events share that connection and may arrive
between responses.

## Envelopes

Request:

```json
{ "v": 1, "type": "request", "id": "1", "op": "system.ping", "params": {} }
```

Success:

```json
{ "v": 1, "type": "response", "id": "1", "ok": true, "result": { "pong": true } }
```

Failure:

```json
{
  "v": 1,
  "type": "response",
  "id": "1",
  "ok": false,
  "error": { "code": "invalid_params", "message": "name is required", "details": {} }
}
```

Event:

```json
{
  "v": 1,
  "type": "event",
  "seq": 42,
  "event": "ui.changed",
  "at": "2026-07-19T23:00:00Z",
  "data": {}
}
```

Mutations may include an `idempotencyKey`. Reusing a key during the same app
run returns the first successful result. Reusing it for different parameters
returns `conflict`.

## Object hierarchy

```text
Workspace
└── Tile
    └── Terminal
        └── persistent PTY process
```

A workspace is a visual group. A tile owns spatial metadata and viewer state. A
terminal owns launch information, process state, and PTY input/output.

### Workspace

```json
{ "id": "ws_123", "name": "website", "position": 0, "tileIds": ["tile_123"] }
```

### Tile

```json
{
  "id": "tile_123",
  "workspaceId": "ws_123",
  "kind": "terminal",
  "name": "dev",
  "label": "wd",
  "position": 0,
  "terminalId": "term_123",
  "viewerState": "attached"
}
```

### Terminal

```json
{
  "id": "term_123",
  "tileId": "tile_123",
  "workingDirectory": "/project",
  "launch": { "kind": "shellCommand", "command": "pnpm dev" },
  "processState": "running",
  "activityState": "working",
  "viewerState": "attached"
}
```

Process states are `starting`, `running`, `stopped`, `exited`, and
`disconnected`. Activity states are `working`, `waiting`, `idle`, and `unknown`.
Machinen derives activity from the persistent PTY's byte counters, foreground
process group, terminal mode, and a throttled process wait-state sample. A
login shell at its prompt is idle; a foreground process blocked on terminal
input is waiting. Detection continues while its viewer is detached. Viewer
states are `attached` and `detached`.

## System

### `system.hello`

```json
{
  "v": 1,
  "type": "request",
  "id": "1",
  "op": "system.hello",
  "params": { "client": { "name": "setup", "version": "1" }, "protocol": { "min": 1, "max": 1 } }
}
```

Returns the selected protocol, application version, socket path, and
capabilities.

### `system.ping`

Returns `{ "pong": true }`.

### `system.snapshot`

Atomically returns `workspaces`, `tiles`, `terminals`, and `ui`.

## Workspaces

- `workspace.list {}`
- `workspace.get { workspaceId }`
- `workspace.create { name, workingDirectory?, position? }`
- `workspace.update { workspaceId, name?, workingDirectory? }`
- `workspace.move { workspaceId, position }`
- `workspace.stop { workspaceId }`
- `workspace.restart { workspaceId }`
- `workspace.delete { workspaceId }`

Every workspace is bound to one validated working directory, which defaults to
the user's home directory. New terminals inherit that directory unless an API
caller explicitly supplies a terminal launch subdirectory. Updating the
workspace directory updates the saved launch directory for its terminals but
does not move files or change the current directory of an already-running
process.

`workspace.delete` fails with `workspace_running` until all of its terminals are
stopped or exited. It then removes the workspace and its stopped tiles without
touching working-directory files.

## Tiles

- `tile.list { workspaceId? }`
- `tile.get { tileId }`
- `tile.create { ... }`
- `tile.update { tileId, name?, label?, activityState? }`
- `tile.move { tileId, workspaceId, position? }`
- `tile.attach { tileId }`
- `tile.detach { tileId }`
- `tile.delete { tileId }`

Detaching removes only the viewer; the PTY process continues. Deleting a tile
fails with `terminal_running` until its terminal is stopped or exited.

Creating a terminal tile and its PTY is one atomic operation:

```json
{
  "v": 1,
  "type": "request",
  "id": "2",
  "op": "tile.create",
  "params": {
    "workspaceId": "ws_123",
    "kind": "terminal",
    "name": "dev server",
    "label": "wd",
    "position": 0,
    "terminal": {
      "workingDirectory": "/project",
      "launch": { "kind": "shellCommand", "command": "pnpm dev" }
    },
    "focus": true
  }
}
```

Supported launches:

```json
{"kind":"loginShell"}
{"kind":"shellCommand","command":"pnpm dev"}
{"kind":"exec","executable":"/usr/bin/env","arguments":["node","server.js"],"environment":{"NODE_ENV":"development"}}
```

The result contains both `tile` and `terminal`.

## Terminals

- `terminal.get { terminalId }`
- `terminal.send { terminalId, text, appendNewline? }`
- `terminal.send { terminalId, dataBase64 }`
- `terminal.signal { terminalId, signal }`
- `terminal.stop { terminalId }`
- `terminal.restart { terminalId, focus? }`

Supported signals are `interrupt`, `terminate`, `kill`, and `hangup`. Exactly one
of `text` and `dataBase64` is required by `terminal.send`. Input goes to the
persistent PTY even when its tile viewer is detached.

There is intentionally no `terminal.close`. Callers must explicitly choose to
detach a tile, stop a terminal, or delete a stopped tile.

## Status bar

- `status.list {}`
- `status.set { ...widget }`
- `status.remove { id, scope? }`

The breadcrumb remains fixed. Programs can publish declarative widgets beside
it without injecting arbitrary AppKit views:

```json
{
  "id": "git.modified",
  "scope": { "kind": "workspace", "id": "ws_123" },
  "placement": "right",
  "kind": "sparkline",
  "label": "modified",
  "graphStyle": "bars",
  "samples": [2, 8, 3, 1],
  "secondarySamples": [0, 2, 5, 1],
  "tone": "attention",
  "tooltip": "4 files have uncommitted changes",
  "ttlMilliseconds": 5000,
  "priority": 70
}
```

Scopes are `global`, `workspace`, and `terminal`. A non-global scope requires a
stable workspace or terminal ID. More specific widgets replace less specific
widgets with the same `id`. Kinds are `text`, `count`, `state`, `progress`,
`timer`, `sparkline`, and `separator`; tones are `neutral`, `good`, `busy`,
`attention`, and `error`. Progress is a number from 0 to 1. Graph styles are
`line`, `area`, `bars`, and `mirrored`; `samples` and `secondarySamples` accept
up to 60 finite numbers. A state widget can render up to 32 graphical pips from
`working`, `waiting`, `idle`, `unknown`, `good`, `busy`, `attention`, and
`error`. Labels and values remain available to API clients and hover tooltips,
but graphical widgets do not render them at rest. A TTL removes stale live data
automatically. `status.list` returns both published widgets and the currently
effective widgets after inheritance and built-in activity indicators.

## UI

- `ui.get {}`
- `ui.select { workspaceId }`
- `ui.select { tileId }`
- `ui.focus { tileId, attach?, activateApplication? }`
- `ui.enter {}`
- `ui.zoomOut { levels: <positive integer> }`
- `ui.zoomOut { levels: "all" }`
- `ui.overview {}`
- `ui.activate {}`

`ui.select` changes selection without entering. `ui.focus` moves the camera into
the tile. Focusing a detached tile requires `attach: true`.

UI state has this shape:

```json
{
  "level": "terminal",
  "selectedWorkspaceId": "ws_123",
  "selectedTileId": "tile_123",
  "focusedTileId": "tile_123"
}
```

## Events

Subscribe on the current connection:

```json
{
  "v": 1,
  "type": "request",
  "id": "3",
  "op": "events.subscribe",
  "params": {
    "events": ["workspace.*", "tile.*", "terminal.*", "ui.changed"],
    "workspaceIds": [],
    "tileIds": [],
    "terminalIds": [],
    "includeOutput": false,
    "includeSnapshot": true
  }
}
```

The result contains `subscriptionId` and, when requested, an atomic `snapshot`.
Call `events.unsubscribe { subscriptionId }` to remove it. All subscriptions
end when the connection closes.

Events:

```text
system.shuttingDown
workspace.created
workspace.updated
workspace.moved
workspace.deleted
tile.created
tile.updated
tile.moved
tile.viewerChanged
tile.deleted
terminal.stateChanged
terminal.activityChanged
terminal.output
status.changed
ui.changed
```

PTY output is a combined byte stream and is emitted only to subscriptions with
`includeOutput: true`. Output is observed through the attached tile viewer;
output produced while the viewer is detached is not buffered or replayed:

```json
{
  "event": "terminal.output",
  "data": {
    "workspaceId": "ws_123",
    "tileId": "tile_123",
    "terminalId": "term_123",
    "dataBase64": "SGVsbG8NCg=="
  }
}
```

## Errors

```text
invalid_request
invalid_params
unsupported_protocol
unknown_operation
workspace_not_found
workspace_name_conflict
workspace_running
tile_not_found
terminal_not_found
terminal_running
terminal_detached
terminal_input_failed
invalid_state
conflict
internal_error
```

## Minimal Python client

```python
import json, os, socket

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(f"/tmp/machinen-{os.getuid()}/api-v1.sock")
f = s.makefile("rwb", buffering=0)

request = {
    "v": 1,
    "type": "request",
    "id": "1",
    "op": "system.hello",
    "params": {"client": {"name": "example", "version": "1"},
               "protocol": {"min": 1, "max": 1}},
}
f.write(json.dumps(request).encode() + b"\n")
print(json.loads(f.readline()))
```
