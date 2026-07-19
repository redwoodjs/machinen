# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 1 — Static live-session deck**

The application currently contains only static mock terminal tiles. It intentionally has no keyboard navigation, animations, command palettes, real terminals, or Machinen integration.

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
