# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 11 — Local automation API**

Every tile is a real local PTY. From the workspace overview, `⌘N` immediately creates a new workspace with a login-shell terminal; inside a workspace, it adds another login-shell terminal there. `⌘T` adds either a login shell or an arbitrary command in context. `⌘K` contains the workspace actions: create with a name, rename, change the persisted project location between a local folder and an SSH-accessible remote folder, and close. `⌘↓` moves one level in and `⌘↑` moves one level out, while every unmodified Escape is passed through to a focused terminal. `⌘W` asks for keyboard confirmation before terminating and removing the selected terminal, or its workspace when it is the only terminal. Claude, Codex, Pi, and other tools are ordinary user commands rather than hardcoded launcher types. Workspaces are uniform visual groups of terminals bound to a persisted local or SSH project location, and a singleton terminal fills its workspace screen.

Each PTY is a viewer attached through Machinen's bundled dtach helper. dtach owns the command, so detaching a viewer or quitting Machinen leaves it running. A private metadata sidecar lets Machinen distinguish active commands, idle login shells, and foreground processes blocked on terminal input without buffering terminal output. Viewers use dtach's `-E` mode, which reserves no escape prefix and passes terminal input through unchanged. Machinen persists workspace, tile, and terminal IDs together with launch definitions, working directories, lifecycle state, grouping, and order in `~/Library/Application Support/Machinen/terminals.json`; relaunching the application rebuilds the same scene and reattaches running viewers. Stop and restart now control real processes, while deleting a workspace removes definitions without deleting working-directory files.

Machinen's product boundary is terminals plus automation. One persistent status bar changes its title from workspace to observed terminal command as the camera moves inward. A versioned, same-user Unix-socket API creates and arranges workspace tiles, launches commands, labels tiles, sends PTY input, streams lifecycle/output events, publishes scoped graphical status widgets, and controls the camera. The [`@machinen/desktop-sdk`](../../packages/desktop-sdk/README.md) is the TypeScript client for that API, while [`@machinen/desktop-mcp`](../../packages/desktop-mcp/README.md) exposes it to MCP-compatible AI clients without opening a network port. Trusted built-in TypeScript services live separately from higher-level agent runtimes such as Eve or Flue. The JSON state file remains private persistence rather than an API. See [`INTERACTIONS.md`](INTERACTIONS.md) for the keyboard and spatial interaction contract and [`API.md`](API.md) for the complete automation protocol.

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

Run the automated interaction check with:

```sh
swift run MachinenDesktop --interaction-tests
```

Requires macOS 14 or newer.
