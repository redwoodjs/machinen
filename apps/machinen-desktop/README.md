# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 6b — Workspace and session hierarchy**

Machinen now renders every workspace and terminal once on one persistent spatial scene. Every workspace occupies a uniform screen, with its full-size terminal surfaces scaled down enough to fit inside. Navigation changes only the camera: Return zooms toward a workspace screen and then a terminal without rebuilding, reflowing, hiding, or crossfading objects. A workspace with one terminal goes directly inside. An entered workspace and a focused terminal each fill 100% of the viewport, become square and borderless, and leave parent-level chrome outside the camera. Escape reverses the camera path through the effective hierarchy; in a focused terminal, the first Escape remains reserved for the terminal and a second rapid Escape navigates out. The Command chord remains an alternative. The prototype intentionally has no real terminals or Machinen integration yet.

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
