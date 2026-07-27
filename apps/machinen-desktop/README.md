# Machinen Desktop interaction prototype

A native macOS prototype for reviewing Machinen's live-session deck one interaction phase at a time.

## Current phase

**Phase 11 — Local automation API**

Machinen Desktop has two input modes: **Navigate mode** for moving through and
arranging the spatial scene, and **Terminal mode** for interacting directly with
a focused terminal.

Every tile is a real local or SSH-hosted PTY. `⌘N` always opens an explicit New chooser: create a workspace, or create a terminal in one of the listed existing workspaces. It never silently creates a terminal in the current workspace. Creating a workspace chooses its unique name first and its default location second. Locations can be reused by several independent workspaces and can come from a local folder browser or an OpenSSH host alias plus remote root such as `mini:~/project`. SSH is currently the workspace default and is inherited by new terminals, while the stable workspace ID leaves room for future terminals and services on other machines; terminals reorder only within their workspace. `⌘T` adds either a login shell or an arbitrary command to the selected workspace. `⌘K` contains workspace actions for create, rename, location changes, and close. `⌘↓` moves one level in and `⌘↑` moves one level out, while every unmodified Escape is passed through in Terminal mode. `⌘W` immediately removes a selected terminal from the scene while retaining its exact PTY and Ghostty surface for five-minute undo with `⇧⌘T`; **Terminate now** commits the close immediately. Closing a workspace still asks for confirmation. Claude, Codex, Pi, and other tools are ordinary user commands rather than hardcoded launcher types. Workspaces are uniquely named visual and automation scopes with a persisted default local or SSH project location, and a singleton terminal fills its workspace screen.

Each PTY is owned by Machinen's bundled native session worker, while embedded Ghostty surfaces remain detachable renderers. The terminal ID is also the stable native-session ID used for reattachment. The worker writes portable visible-screen checkpoints and sequenced output to SQLite, so quitting Desktop or losing an SSH connection leaves the command running. Desktop reconnects from a fresh in-memory visible-screen checkpoint and then consumes live output, avoiding retained journal replay on the new Ghostty surface. The reconnected renderer starts with the current screen rather than rebuilding older scrollback. Interactive writer and resize leases prevent multiple viewers from fighting over one PTY. For remote workspaces the helper runs on the SSH host beside the process; Desktop installs the versioned static binary through the user's OpenSSH configuration. Live protocol-v1 native sessions remain attached through their existing worker. Manifests that predate the native session backend keep their launch definition but load stopped and require an explicit restart. Machinen persists workspace, tile, and terminal IDs together with backend, launch definition, working directory, lifecycle state, grouping, and order in `~/Library/Application Support/Machinen/terminals.json`; native recovery data lives separately in `sessions.sqlite3`.

Machinen's product boundary is terminals plus automation. One persistent status bar changes its title from workspace to observed terminal command as the camera moves inward. A versioned, same-user Unix-socket API creates and arranges workspace tiles, launches commands, labels tiles, sends PTY input, streams lifecycle/output events, publishes scoped graphical status widgets, and controls the camera. The [`@machinen/desktop-sdk`](../../packages/desktop-sdk/README.md) is the TypeScript and agent code-mode client for that API. Trusted built-in TypeScript services live separately from higher-level agent runtimes such as Eve or Flue. The JSON state file remains private persistence rather than an API. See [`INTERACTIONS.md`](INTERACTIONS.md) for the keyboard and spatial interaction contract and [`API.md`](API.md) for the complete automation protocol.

Ghostty 1.3.1 is fetched at commit `332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28`, compiled into a local XCFramework, and statically linked into the app. Its unstable embedding API is isolated behind `GhosttyRuntime` and `MachinenTerminalView`; Ghostty's standard config files control renderer settings such as `scrollback-limit`. The approximately 1 MB `machinen-session` helper separately includes SQLite and builds for macOS and Linux. See [`Dependencies/README.md`](Dependencies/README.md) for dependency hashes and build details.

## Run

```sh
cd apps/machinen-desktop
./prepare-ghostty.sh
swift run MachinenDesktop
```

A source build does not contain Node.js or the compiled TypeScript services. In
another terminal, run the status services while using `swift run`:

```sh
pnpm -F @machinen/desktop-services dev
```

To build a transferable application bundle:

```sh
./build-app.sh release
open Machinen.app
```

`build-app.sh` compiles the status services and includes them with a Node.js
runtime in `Machinen.app`. The app starts the services after its local API is
ready, restarts them after unexpected exits with bounded backoff, and stops them
when the app quits. The bundled app does not need a separate `pnpm dev` process.

Run the automated interaction check with:

```sh
./prepare-ghostty.sh
swift run MachinenDesktop --interaction-tests
```

Requires macOS 14 or newer.
