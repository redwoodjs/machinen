# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phases 9 and 10 — Real persistent terminals**

Every tile is a real local PTY. `⌘T` creates either a login shell or an arbitrary command; Claude, Codex, Pi, and other tools are ordinary user commands rather than hardcoded launcher types. Workspaces are uniform visual groups of terminals, and a singleton terminal fills its workspace screen.

Each PTY is a viewer attached through Machinen's bundled dtach helper. dtach owns the command, so detaching a viewer or quitting Machinen leaves it running. Viewers use dtach's `-E` mode, which reserves no escape prefix and passes terminal input through unchanged. Machinen persists terminal IDs, commands, working directories, lifecycle state, workspace grouping, and order in `~/Library/Application Support/Machinen/terminals.json`; relaunching the application rebuilds the same scene and reattaches running viewers. Stop and restart now control real processes, while deleting a workspace removes definitions without deleting working-directory files.

Machinen's product boundary is terminals plus automation. A future lightweight scripting layer will create workspace screens, launch commands, label terminals, send input, and control the camera/UI. The language remains intentionally undecided. The JSON state file is private persistence, not the scripting API; `MachinenTerminalView` and `TerminalSessionStore` isolate the terminal and persistence mechanisms from that future command layer.

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
