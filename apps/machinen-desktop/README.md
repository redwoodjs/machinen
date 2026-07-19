# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 6 — New-terminal flow**

Press Command-T from the overview or a focused session to start Shell, Claude Code, Codex, Pi, or an arbitrary command in the current workspace. Choose Another Project opens a folder picker. A simulated Starting tile appears and automatically focuses when ready. The prototype intentionally has no real terminals or Machinen integration yet.

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
