# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 7 — States and lifecycle language**

Machinen renders every workspace and terminal once on one persistent spatial scene; navigation changes only the camera. The prototype now demonstrates starting, working, waiting, idle, stopped, disconnected, and intentionally detached sessions. `⌘K` exposes distinct attach, reconnect, detach, restart, stop-session, stop-workspace, delete-workspace, diagnostics, and simulated-relaunch actions. Destructive actions explain their scope before confirmation, diagnostics are selectable and copyable, and `⌘W` never closes Machinen: it detaches a focused viewer while leaving its session running and otherwise does nothing. All lifecycle behaviour remains simulated; there are still no real terminals or Machinen integration.

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
