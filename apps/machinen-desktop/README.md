# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 6b — Workspace and session hierarchy**

Machinen now opens on a workspace deck. Return enters a workspace, whose live terminal sessions form a second deck; Return focuses a session edge to edge. Escape returns from a session deck to workspaces. In a focused terminal, one Escape is reserved for the terminal and a second rapid Escape returns to the session deck. The Command chord remains an alternative. The prototype intentionally has no real terminals or Machinen integration yet.

## Run

```sh
cd apps/machinen-desktop
swift run MachinenDesktop
```

To build a transferable application bundle:

```sh
./build-app.sh release
open Machinen.app
```

Requires macOS 14 or newer.
