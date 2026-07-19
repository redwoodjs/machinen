# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 2 — Overview selection**

The deck supports mouse selection, arrow-key navigation, short typeable tile labels, and Return/double-click activation feedback. It intentionally has no focus animation, command palettes, real terminals, or Machinen integration yet.

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
