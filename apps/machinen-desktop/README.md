# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 4 — Peek and ordering**

Hold Space to peek at the selected terminal, drag tiles to reorder them, or use Command plus an arrow key to swap the selected tile with its neighbour. Focus and return remain edge-to-edge. The prototype intentionally has no command palettes, real terminals, or Machinen integration yet.

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
