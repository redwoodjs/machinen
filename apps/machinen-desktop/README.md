# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 11 — Local automation API**

Every tile is a real local PTY. `⌘T` creates either a login shell or an arbitrary command; Claude, Codex, Pi, and other tools are ordinary user commands rather than hardcoded launcher types. Workspaces are uniform visual groups of terminals, and a singleton terminal fills its workspace screen.

Each PTY is a viewer attached through Machinen's bundled dtach helper. dtach owns the command, so detaching a viewer or quitting Machinen leaves it running. Viewers use dtach's `-E` mode, which reserves no escape prefix and passes terminal input through unchanged. Machinen persists workspace, tile, and terminal IDs together with launch definitions, working directories, lifecycle state, grouping, and order in `~/Library/Application Support/Machinen/terminals.json`; relaunching the application rebuilds the same scene and reattaches running viewers. Stop and restart now control real processes, while deleting a workspace removes definitions without deleting working-directory files.

Machinen's product boundary is terminals plus automation. A versioned, same-user Unix-socket API now creates and arranges workspace tiles, launches commands, labels tiles, sends PTY input, streams lifecycle/output events, and controls the camera. The [`@machinen/mcp`](../../packages/mcp/README.md) stdio adapter exposes those operations to MCP-compatible AI clients without opening a network port. The JSON state file remains private persistence rather than an API. See [`API.md`](API.md) for the complete protocol. The scripting language remains intentionally undecided.

SwiftTerm `v1.15.0` is pinned to commit `dd2fb8ac5b861e7bf617c872895e338f38165648`. dtach `0.9` is built from vendored source as a signed helper executable. Ghostty's current macOS embedding path requires its private, unstable application API and the full Xcode Metal toolchain; the terminal host boundary keeps a later engine replacement contained.

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
