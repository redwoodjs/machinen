# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 3 — Focus and return**

A selected tile now animates into a focused terminal and returns to its original grid position with cmdcmd's simultaneous left-and-right Command gesture. Mock terminal output continues updating while sessions are hidden. The prototype intentionally has no command palettes, real terminals, or Machinen integration yet.

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
