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
between responses. TypeScript programs can use
[`@machinen/desktop-sdk`](../../packages/desktop-sdk/README.md); the wire
protocol remains language-neutral JSON.

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
Target machine (local is implicit; SSH is registered)
└── Workspace
    └── Tile
        └── Terminal
            └── persistent PTY process
```

A workspace owns its project directory and workspace-scoped status items. A tile
owns spatial metadata, viewer state, and its live foreground PID. A terminal
owns launch information, process state, and PTY input/output.

### Workspace

```json
{
  "id": "ws_123",
  "name": "website",
  "location": { "kind": "ssh", "host": "mini", "path": "/project" },
  "workingDirectory": "/project",
  "position": 0,
  "tileIds": ["tile_123"]
}
```

### Tile

```json
{
  "id": "tile_123",
  "workspaceId": "ws_123",
  "kind": "terminal",
  "name": "dev",
  "label": "wd",
  "pid": 4242,
  "shellPid": 4201,
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
  "pid": 4242,
  "shellPid": 4201,
  "workingDirectory": "/project",
  "currentWorkingDirectory": "/project/packages/web",
  "location": { "kind": "ssh", "host": "mini", "path": "/project" },
  "launch": { "kind": "shellCommand", "command": "pnpm dev" },
  "backend": "machinenSession",
  "processState": "running",
  "activityState": "working",
  "viewerState": "attached",
  "geometry": {
    "columns": 149,
    "rows": 42,
    "generation": 7,
    "ownerClientId": 123456,
    "controlledByThisViewer": true
  }
}
```

`workingDirectory` and `location` describe where the terminal was launched.
`currentWorkingDirectory` is the latest absolute path reported by OSC 7 and is
`null` until the terminal program emits one. It follows an interactive shell
after `cd` and is retained across Desktop relaunches as the last known value.

`pid` and `shellPid` are best-effort metadata from the native worker that owns
the PTY and may be `null` for an older live worker. `backend` is always
`machinenSession`.

Process states are `starting`, `running`, `stopped`, `exited`, and
`disconnected`. Activity states are `working`, `waiting`, `idle`, and `unknown`.
`geometry` is `null` until Desktop has queried a supporting worker. It describes
the PTY's one authoritative cell grid, not the local tile's pixels. A watcher
fits that grid into its own tile without reflowing the terminal.
The foreground login shell is `idle`; another foreground process is `working`.
Recent output also reports `working`. Workers created before native telemetry
remain `unknown` until explicitly restarted. Callers may provide a stronger
activity state through `tile.update`. Viewer states are `attached` and
`detached`.

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

Atomically returns `targets`, `workspaces`, `tiles`, `terminals`, and `ui`.

## Targets

- `target.list {}`
- `target.register { host }`
- `target.remove { targetId }`
- `target.sessions {}`

Local is the implicit `local` target and cannot be removed. An SSH target has a
persisted opaque ID and an OpenSSH `host` connection profile (an alias or
`user@host`). Registering an existing profile is idempotent. `target.list`
reports `online`, `unreachable`, or `inactive`; unreachable preserves the last
discovery result and is not inactive. Automatic polling is single-flight per
target and backs off after repeated failures. `target.sessions` groups native workspace
records and running sessions by target. Discovery never changes Desktop's scene
or attaches a renderer. `target.remove` only stops future polling; it never
copies SQLite, PTY state, or terminal output.

## Workspaces

- `workspace.list {}`
- `workspace.get { workspaceId }`
- `workspace.create { name, location?, workingDirectory?, position? }`
- `workspace.update { workspaceId, name?, location?, workingDirectory? }`
- `workspace.move { workspaceId, position }`
- `workspace.stop { workspaceId }`
- `workspace.restart { workspaceId }`
- `workspace.delete { workspaceId }`

Every workspace has a stable ID and a unique, case-insensitive name. Machinen
trims surrounding whitespace when creating or renaming a workspace. A workspace
also has one mutable directory root, which may be shared by other explicitly
identified workspaces. The native session store on the machine owning that root
persists the workspace ID, name, root, and explicit session membership. Desktop's
private manifest owns its local spatial scene. Registered targets are polled
for native workspaces and sessions, but discovery never reconstructs a
workspace, creates a tile, or attaches a viewer. Opening a discovered workspace
or attaching a session is always explicit. A local location is
`{ "kind": "local", "path": "/project" }`. A remote location is
`{ "kind": "ssh", "host": "mini", "path": "/project" }`; `host` uses the
user's OpenSSH configuration and may include a username. The legacy
`workingDirectory` field remains the location path for compatibility. Workspace
results also expose `machineId`: `local` for the Mac running Desktop, or
`ssh:<host>` for an SSH location.

New terminals inherit the workspace location unless an API caller explicitly
supplies a launch subdirectory. Their native records store `workspace_id`
separately from that launch directory, so changing directory or reconnecting
from another Desktop does not lose membership. Remote terminals install and run
the native session worker on the SSH host; Desktop's Ghostty viewer attaches through SSH.
Git and service probes use that same SSH connection model. `workspace.update`
can change the default location at any time. Existing terminals retain their
own execution locations and are neither moved nor restarted.

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

`tile.move` reorders a tile only within its existing workspace. Moving it to a
different workspace fails with `terminal_relocation_unsupported`, because a
terminal cannot silently change execution locations. Detaching removes only the
viewer; the PTY process continues. Deleting a tile fails with `terminal_running`
until its terminal is stopped or exited.

Creating a terminal tile and beginning its PTY launch is one atomic operation. The tile and its terminal viewport appear immediately; local process creation or SSH connection continues while `processState` is `starting`, then publishes `terminal.stateChanged` with `running`. Callers do not need a separate attach operation, but should observe the lifecycle event when they require a ready PTY:

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
- `terminal.update { terminalId, title }`
- `terminal.update { terminalId, title: null }`
- `terminal.send { terminalId, text, appendNewline? }`
- `terminal.send { terminalId, dataBase64 }`
- `terminal.signal { terminalId, signal }`
- `terminal.resize { terminalId, columns, rows }`
- `terminal.stop { terminalId }`
- `terminal.restart { terminalId, focus? }`

In Terminal mode, Machinen displays the focused terminal as
`workspace > terminal name`. The foreground process remains available as
telemetry and hover detail. `terminal.update`
sets a persistent title override for agentic systems; setting `title` to `null`
resumes automatic detection. It changes presentation, not the running process or
saved launch definition.

Supported signals are `interrupt`, `terminate`, `kill`, and `hangup`. Exactly one
of `text` and `dataBase64` is required by `terminal.send`. Input goes to the
persistent PTY even when its tile viewer is detached. `terminal.resize` accepts
columns and rows from 1 through 1000, performs `TIOCSWINSZ` in the session
worker, and causes the kernel to deliver `SIGWINCH`. Attached renderers adopt
the accepted grid immediately; the controlling viewer's next local viewport
change may replace it with that viewer's new dimensions.

There is intentionally no `terminal.close`. Callers must explicitly choose to
detach a tile, stop a terminal, or delete a stopped tile. Desktop's `⌘W`
interaction disconnects the viewer and removes the tile from snapshots while
the native session keeps running. It emits `tile.disconnected`; reconnecting
emits `tile.reconnected` with the same IDs, and a second `⌘W` or the session
panel's Kill action emits `tile.killed` while removing the native session. API
`tile.delete` retains its explicit immediate semantics.

## Status data

- `status.list {}`
- `status.set { ...widget }`
- `status.remove { id, scope? }`

The persistent top bar shows the workspace and terminal titles. Its right edge
contains only the build version and the spatial minimap. The minimap encodes each
terminal's activity in its pane outline. Hovering it reveals its large read-only
counterpart.

Programs can publish declarative status records for API clients:

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

Scopes are `global`, `machine`, `workspace`, and `terminal`. A non-global scope
requires an ID. Stable machine IDs come from workspace results; workspace and
terminal scopes use their corresponding stable IDs. More specific widgets
replace less specific widgets with the same `id` in global → machine → workspace
→ terminal order. Kinds are `text`, `count`, `state`, `progress`,
`timer`, `sparkline`, and `separator`; tones are `neutral`, `good`, `busy`,
`attention`, and `error`. Progress is a number from 0 to 1. Graph styles are
`line`, `area`, `bars`, and `mirrored`; `samples` and `secondarySamples` accept
up to 60 finite numbers. A state widget can render up to 32 graphical pips from
`working`, `waiting`, `idle`, `unknown`, `neutral`, `good`, `busy`, `attention`,
and `error`. A widget can include up to 32 `links`, each with a title and HTTP(S)
URL. Labels, values, samples, and links remain available to API clients. The top
bar does not render published status records. A TTL removes stale live data
automatically. `status.list` returns both published widgets and the currently
effective widgets after spatial-scope inheritance.

## Context commands

- `command.list {}`
- `command.set { id, title, context, subtitle?, group?, locationKinds?, priority?, ttlMilliseconds? }`
- `command.remove { id }`

Trusted TypeScript services can register commands in the native `⌘K` palette.
`context` is either `workspace` or `terminal`. Workspace commands are available
whenever a workspace is selected and receive its current default location.
Terminal commands are available only while a terminal is focused and receive
the terminal's OSC 7 working directory, falling back to its launch directory
until OSC 7 has been observed. Commands with the same optional `group` and
context appear under one nested palette command. `locationKinds` can restrict a
command to local or SSH locations. Higher priorities appear first among
registered commands.

As with selection openers, registrations are metadata with optional TTLs. The
service subscribes to `command.invoked` and performs the implementation through
ordinary Desktop API operations:

```ts
await desktop.commands.set({
  id: "example.yazi-cwd",
  title: "Yazi",
  group: "Open in…",
  context: "terminal",
  ttlMilliseconds: 30_000,
});
```

```json
{
  "event": "command.invoked",
  "data": {
    "invocationId": "inv_123",
    "commandId": "example.yazi-cwd",
    "context": "terminal",
    "workspaceId": "ws_123",
    "tileId": "tile_123",
    "terminalId": "term_123",
    "workingDirectory": "/project/packages/web",
    "location": {
      "kind": "ssh",
      "host": "mini",
      "path": "/project/packages/web"
    }
  }
}
```

A workspace invocation omits `tileId` and `terminalId`. The invocation freezes
the context that was active when Return was pressed.

## Selection openers

- `selectionOpener.list {}`
- `selectionOpener.set { id, title, subtitle?, selectionPattern?, locationKinds?, priority?, ttlMilliseconds? }`
- `selectionOpener.remove { id }`

Selection openers let trusted TypeScript services define destinations in the
terminal's **Open Selection With** submenu. Right-clicking a terminal shows the
full context menu, and `⌘O` opens that same menu from the keyboard. When text is
selected, its **Open Selection With** submenu contains matching destinations. An
optional case-insensitive `selectionPattern` filters cheap native-menu matches;
`locationKinds` can contain `local`, `ssh`, or both. Exact parsing and validation
remain in TypeScript. Higher priorities appear first.
`selectionOpener.list` returns `{ openers: [...] }`.

Registrations are declarative metadata, not executable code. A service subscribes
to `selectionOpener.invoked`, finds its opener by `openerId`, and performs work
through the rest of the API. `ttlMilliseconds` lets openers disappear if their
service exits; a long-running service should refresh its registrations before
they expire.

```ts
await desktop.selectionOpeners.set({
  id: "example.open-markdown",
  title: "Glow",
  ttlMilliseconds: 30_000,
});
```

An invocation contains the exact selected text and enough execution context to
create work in the same workspace and location. Its `workingDirectory` and
`location.path` use the latest OSC 7 directory, falling back to the terminal's
launch directory:

```json
{
  "event": "selectionOpener.invoked",
  "data": {
    "invocationId": "inv_123",
    "openerId": "example.open-markdown",
    "selection": "docs/guide.md",
    "workspaceId": "ws_123",
    "tileId": "tile_123",
    "terminalId": "term_123",
    "workingDirectory": "/project",
    "location": { "kind": "ssh", "host": "mini", "path": "/project" }
  }
}
```

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
workspace.restored
workspace.updated
workspace.moved
workspace.deleted
tile.created
tile.updated
tile.moved
tile.viewerChanged
tile.disconnected
tile.reconnected
tile.killed
tile.deleted
terminal.stateChanged
terminal.activityChanged
terminal.commandChanged
terminal.workingDirectoryChanged
terminal.geometryChanged
terminal.updated
terminal.output
status.changed
command.changed
command.invoked
selectionOpener.changed
selectionOpener.invoked
target.registered
target.removed
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
terminal_relocation_unsupported
context_action_not_found
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
