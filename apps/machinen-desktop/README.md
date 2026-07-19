# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 6b — Workspace and session hierarchy**

Machinen now opens on a deck of workspace clusters, each containing miniature live terminal tiles. Return spatially zooms into a cluster and reveals its session deck; Return again focuses a session edge to edge. A workspace with only one terminal skips the redundant session deck and goes directly inside. Escape zooms back through the effective hierarchy. In a focused terminal, one Escape is reserved for the terminal and a second rapid Escape navigates out. The Command chord remains an alternative. The prototype intentionally has no real terminals or Machinen integration yet.

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
