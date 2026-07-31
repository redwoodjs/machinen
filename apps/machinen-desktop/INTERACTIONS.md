# Machinen Desktop interaction contract

Machinen presents one persistent spatial scene. Navigation moves a camera over
live terminal surfaces; it does not rebuild, hide, crossfade, or reflow them.

## Hierarchy

```text
workspace
└── tile
    └── terminal
        └── persistent PTY process
```

A **workspace** has a stable ID and a mutable directory root—either a local
folder or an SSH host plus remote folder—and workspace-scoped status items. The
native session store on the execution machine persists that workspace record and
explicit session membership, while each Desktop keeps only its own presentation
cache. A **tile** is the
spatial object reordered within that workspace; it links the terminal to its
current foreground process PID. A **terminal** owns
the launch configuration, emulator, and persistent PTY. A workspace with one
tile skips the redundant workspace level when entered; its tile fills the entire
workspace surface. Terminal launchers, Git instruments, and local service
discovery use the workspace directory as their project boundary.

## Navigation

| Input           | Behavior                                                                           |
| --------------- | ---------------------------------------------------------------------------------- |
| `⌘+` / `⌘−`     | Magnify/demagnify the camera in equal increments without changing hierarchy level. |
| `⌘0`            | Reset camera magnification to actual size without changing hierarchy level.        |
| `⌘,`            | Open the Desktop settings file in the user's default editor.                       |
| `⇧⌘↓` or Return | Enter the selected workspace or pane.                                              |
| `⇧⌘↑`           | Leave the current pane or workspace.                                               |
| `⇧⌘←` / `⇧⌘→`   | From Terminal mode, focus the previous/next pane in the current workspace.         |
| `⇧⌘[` / `⇧⌘]`   | From Terminal mode, focus the active pane in the previous/next workspace.          |
| `⌘N`            | Open the New chooser; never create a terminal or workspace immediately.            |
| `⌘K`            | Open the single nested command menu for the current and containing spaces.         |
| `⌘O`            | Show the focused terminal's full context menu.                                     |
| `⌘W`            | Disconnect a terminal; press again in its toast or panel to kill its session.      |
| Keyboard input  | In Terminal mode, the terminal receives all other keys and modifier combinations.  |
| Arrow keys      | Move the selection only at the current overview level.                             |
| `⇧` + arrows    | Reorder the selected pane or workspace in the chosen direction.                    |
| Click           | A terminal preview focuses its terminal.                                           |
| Right-click     | Show Copy, Paste, Select All, and the **Open Selection With** submenu.             |
| Drag preview    | Inside a workspace, reorder its terminal tiles. Never change their workspace.      |
| Drag terminal   | Forward the drag for terminal selection/input.                                     |
| Hold Space      | Momentarily peek into the selection.                                               |

Machinen writes the spatial shortcuts to `~/.config/machinen/config.json` on
first launch and adds new defaults to older files. The actions are `enter`,
`leave`, `selectLeft`, `selectRight`, `selectDown`, `selectUp`, `moveLeft`,
`moveRight`, `moveDown`, `moveUp`, `previousPane`, `nextPane`,
`previousWorkspace`, and `nextWorkspace`. The file is read when Desktop starts.

## Input modes

- **Navigate mode:** no terminal is focused. It has two camera levels:
  - **Workspace overview:** unlabeled workspace cards contain terminal previews
    that do not move out of them; cards can be dragged to reorder workspaces.
  - **Workspace deck:** terminal previews can be dragged to reorder them inside
    that workspace.
- **Terminal mode:** one terminal is focused, and its viewport owns every
  pointer and keyboard event. Spatial dragging, overview navigation, and
  application command equivalents do not intercept terminal input, except
  `⌘+` / `⌘−`, the configured Desktop shortcuts, `⌘N`, `⌘K`, and `⌘O`.
  `previousPane` and `nextPane` wrap through the terminals in the current
  workspace by switching the camera immediately without leaving Terminal mode
  or changing zoom. `previousWorkspace` and `nextWorkspace` wrap through
  non-empty workspaces: they zoom out to the source workspace, zoom out to the workspace
  overview, select the adjacent workspace, and then zoom into its last active pane.
  `⌘K` opens context-aware commands without changing camera level. `⌘O` opens
  the focused terminal's full context menu, including its **Open Selection
  With** submenu when text is selected.

`⌘+` / `⌘−` changes only camera magnification in equal increments, and `⌘0` resets it to actual size; all preserve the current hierarchy level. The configured `enter` and `leave` actions move through the camera hierarchy. Neither changes terminal scrollback.
The terminal viewport keeps the same intrinsic bounds and Ghostty grid while the
camera moves. Navigate mode shows a scaled version of that unchanged surface;
it does not resize or reflow the terminal. Leaving Terminal mode therefore
cannot shift its content or scroll position.

Machinen never interprets an unmodified Escape in Terminal mode. The byte goes
directly to the PTY, so terminal programs retain their normal Escape behavior.
`⌘C` copies the current terminal selection, `⌘V` pastes plain text into the
terminal, and `⌘A` selects its terminal buffer.

A terminal never moves between workspaces: its workspace is its execution
location. Once inside a workspace, terminal previews can be dragged only to
reorder them. The focused terminal viewport remains an input surface, so clicks,
drags, and keyboard shortcuts go to its terminal. Workspace cards retain
spatial reordering in the overview; a short click never becomes a drag, and the
source fades only after a five-point movement threshold.

## Creating terminals and workspaces

`⌘N` always opens the same **New** chooser, regardless of the current camera
level or whether a terminal is focused. It never silently assumes that the user
wants another terminal in the current workspace, and opening or cancelling the
chooser does not change persisted state.

The chooser contains:

1. **New workspace…**
2. **New terminal in…**, followed by every existing workspace. The current
   workspace may be highlighted as the suggested destination, but it is not
   selected implicitly. Choosing a workspace creates a login-shell terminal
   there and enters it.

When no workspace exists, only **New workspace…** is available.

### New workspace flow

Creating a workspace chooses its default location before naming it:

1. **Choose a location.** Previously selected local and SSH locations appear
   first and can be reused directly. **Browse local…** opens Machinen's directory
   picker at `$HOME`. **Browse over SSH…** chooses an OpenSSH host and opens the
   same picker model at that host's `$HOME`; Return opens a child folder, while
   **Use this folder** selects the current directory.
2. Machinen asks the native session store on that machine whether the directory
   already roots a workspace. If it does, Desktop restores the saved workspace
   ID and name and opens its Sessions panel; it does not create an empty duplicate.
3. Otherwise, **name the workspace.** Machinen suggests the selected directory's
   basename. Names are trimmed, case-insensitively unique, and remain editable
   later. The dialog keeps validation errors in place.
4. Machinen saves the workspace in the native store, creates its initial
   login-shell terminal, and enters it.

Escape always moves back one dialog or remote parent-directory level; it closes
the dialog only from the top-level New chooser. Picking a registered location
restores its workspace; a location without a native record creates a new one.

**SSH is a workspace location, not a special terminal type.** The SSH flow asks
for an OpenSSH host or alias (for example `mini` or `peter@server`) and then a
remote folder (for example `~/gh/project` or `/srv/project`). Machinen stores the
pair as `host + remote root`, validates it through the user's OpenSSH
configuration, and every terminal created in that workspace inherits it. The
remote browser lists one directory level at a time over SSH, starting at the
remote user's `$HOME`.

Creating a terminal in the selected workspace is a nested **New terminal…**
command under `⌘K`. It can create a login shell or run an arbitrary command.
Escape returns from those choices to the context-aware command menu. There is no
separate `⌘T` launcher; `⌘N` remains the explicit what-and-where chooser.

## Open Selection With and context commands

Right-clicking a terminal shows its normal editing commands and an **Open
Selection With** submenu. `⌘O` opens the same selection context menu from the
keyboard. When text is selected, `⌘K` also adds **Open Selection With…** to its
Terminal section; choosing it opens a nested palette of matching registered
destinations. Choosing a destination from either surface publishes the full
selected text, terminal working directory, execution location, and stable
workspace/tile/terminal IDs through the local API. Relative paths resolve from
the latest OSC 7 directory, falling back to the terminal's launch directory. Trusted TypeScript
`SelectionOpener` implementations perform precise validation and ordinary API
operations such as creating a terminal or revealing a path in Finder.

`⌘K` and the application menu's **Commands…** organize commands around the
three camera spaces: **Workspace Overview**, **Workspace**, and **Terminal**.
The menu starts with the current space and cascades outward through its
containing spaces. Workspace Overview therefore shows only overview commands;
Workspace shows Workspace followed by Workspace Overview; and Terminal shows
Terminal, Workspace, then Workspace Overview. Section headings keep each
command's target explicit, and search preserves that section order while
filtering the commands that are valid in the current context.

The menu contains seven built-in actions plus matching commands registered by
trusted TypeScript services. **New workspace…** belongs to Workspace Overview;
**New terminal…** and the remaining workspace actions belong to Workspace.
**Disconnect terminal** belongs to Terminal and shows its `⌘W` shortcut.
**Open Selection With…** appears in Terminal when selected text has a matching
opener. Escape always moves back one level within a command flow; only Escape
from this top-level menu dismisses it:

1. **Disconnect terminal** immediately removes the terminal tile and disconnects
   its viewer while leaving the native session and process running. The same
   reconnect-or-kill toast used by `⌘W` appears.
2. **New workspace…** opens the same location-then-name flow used by `⌘N`,
   creates an initial login-shell terminal, and enters it.
3. **New terminal…** opens nested choices for a login shell, an arbitrary
   command, or a new workspace from a folder.
4. **Rename workspace…** changes the visible name while preserving the stable
   workspace ID and all terminals.
5. **Change workspace location…** chooses either a local folder or a remote
   `alias:path` reachable through the user's SSH configuration. It is available
   at any time, including while terminals are running.
6. **Sessions…** opens a floating, keyboard-navigable list of every terminal
   session in the workspace. Each row shows this Desktop's attachment state,
   every connected client, and the current controller. Return attaches or
   detaches normally; when this Desktop is an attached watcher, Return takes
   writer and resize control while leaving the previous controller connected.
   Delete or `⌘W` kills the session.
7. **Close workspace…** asks for confirmation, terminates its PTY processes,
   and removes its saved workspace and terminal definitions.

A registered command declares either a **workspace** or **terminal** context.
Commands that declare the same optional group appear under one nested command;
the bundled directory actions use **Open in…** with **Glow** and **Yazi** choices
in both contexts. Workspace commands receive the selected workspace's default
local or SSH location. Terminal commands appear only in Terminal mode and receive the
focused terminal's current directory. Ghostty updates that directory when a
shell or application emits OSC 7 after changing directory; before the first
report, Machinen uses the terminal's launch directory. The invocation contains
the stable workspace ID and, for terminal commands, the tile and terminal IDs.

An SSH workspace is entered as `alias:~/folder`, `alias:/absolute/folder`, or
`user@host:/absolute/folder`. The host can be any alias understood by the user's
OpenSSH configuration. Machinen checks the connection and resolves the remote
folder before creating or rebinding the workspace; the folder must already
exist.

Machinen allows several explicitly identified workspaces to share a location and
allows a location to change at any time. Existing terminals keep their own
execution locations; they are not moved or restarted. The native stores retain
the stable workspace ID and explicit membership on every machine that still owns
one of its sessions, while the new location becomes the root for new terminals
and workspace-scoped services. For an SSH location, Machinen installs its small native session helper
on the SSH host and the remote worker owns the PTY in the selected folder. The
local Ghostty view attaches through SSH, so closing Desktop or losing the SSH
connection does not stop remote work. Git instruments and local-service
discovery also probe that folder through SSH.

When no workspace exists, only **New workspace…** is shown.

### Workspace naming rules

- Input is trimmed before it is accepted.
- The name must contain at least one non-whitespace character.
- Names must be unique using the current case-sensitive comparison.
- Spaces, punctuation, and Unicode are allowed.
- Keyboard control characters and line breaks are not accepted by the name
  prompt.
- Names are visual labels, not directory paths.

## Activity and input-required detection

Machinen separates PTY lifecycle from activity. The native worker asks its PTY
for the foreground process group: any foreground interactive shell, including a
nested `bash`, `zsh`, or other recognized shell, is `idle`, while a foreground
non-shell command is `working`. An interactive `ssh` transport is also idle at a
quiet remote prompt and becomes transiently working when output arrives. Recent
output otherwise reports `working`, except that renderer redraws cannot override
authoritative idle nested-shell telemetry.
Live pre-telemetry workers use a compatibility fallback: recent viewer output is
`working`, while a quiet persistent session is `idle`. Stopped, exited, or
unreadable sessions remain `unknown` unless a trusted API client supplies a
stronger state through `tile.update`.

The worker publishes shell and foreground PIDs, process names, and activity over
its private native protocol while continuing to journal byte-exact output and
ordered resize events to SQLite. This works for attached, detached, local, and
SSH sessions because observation happens beside the PTY rather than through a
Desktop-side process-list guess. At workspace level the status bar renders
terminals as spatially ordered activity pips; waiting and failed terminals
receive attention and error tones. In Terminal mode the indicator follows the
focused terminal, shows its foreground PID on hover, and copies that PID when
clicked.

## Programmable status bar

Machinen has one persistent status bar. The workspace title is a dropdown of all
workspaces in spatial order. Choosing its current workspace moves the camera one
level out; choosing another workspace enters that workspace. At terminal level,
the terminal title is a second dropdown of that workspace's terminals in spatial
order, so choosing one focuses it. Hovering either title reveals its bound path,
and terminal hover detail also shows any observed foreground command. An API
client can set a persistent title
override with `terminal.update`, or clear it to return to the saved terminal
name. A terminal program can set a temporary
runtime label with OSC 2 `machinen:<label>` (and clear it with `machinen:`);
that label takes precedence in the status title, survives a viewer relaunch, and
works through SSH.

The macOS **View** menu contains **Show Debug Information**, which presents the
current workspace or terminal's diagnostics without interrupting its PTY.

The top-right strip keeps a built-in `Desktop <version> · Session <version>`
item at its right edge, using the app bundle version and bundled native session
handler version. The remaining items are graphical at rest. The strip occupies
its own layout row; the scene viewport starts below it, so terminal content
never renders underneath the status bar. In a **workspace**, its activity
monitor summarizes all terminals with visible active/idle/waiting tile counts,
and the strip also shows aggregate tile CPU, aggregate tile network transfer,
and branch-wide Git changes. The Git item shows only the total changed-file count at rest; hovering
reveals the branch, commits since its default-branch merge base, changed files,
and added and deleted lines. In a **focused tile**, the activity indicator shows that tile's state; hovering
shows its foreground PID as `PID #### · click to copy`, and clicking copies the
number. When a running native session inside the workspace has no Desktop tile,
a count item appears in the strip; clicking it opens the same panel as
**Sessions…**. The strip also shows CPU and network transfer for that PID and its local
child processes, plus workspace branch changes. Git is
scoped to the selected workspace. Open ports include listeners whose process
working directory is the selected workspace folder or one of its descendants,
on either the local Mac or the workspace's SSH host. Hover lists each TCP
listener on its own line with the process and bind address;
clicking the instrument presents those listeners, and choosing one opens its
HTTP URL through the default macOS handler. Trusted TypeScript desktop services
publish activity, Git, ports, CPU, and network widgets through the local API. Process network bytes come from macOS `nettop`. Tile activity is a
label-free graphical indicator; Desktop supplies its terminal-level state and
PID interaction directly from native session telemetry.

Programs can publish scoped text, count, state, progress, timer, sparkline, and
separator widgets through `status.set`, `status.list`, and `status.remove`.
Sparklines accept line, area, bars, and mirrored styles with primary and
secondary sample arrays. State widgets accept arrays of semantic pip states.
Machine widgets override global widgets, workspace widgets override machine
widgets, and terminal widgets override workspace widgets with the same ID. TTLs
remove stale live data.

## Disconnecting and killing

`⌘W` never closes Machinen's macOS window:

- Inside a workspace, `⌘W` removes the selected terminal tile and disconnects its viewer. The native session, PTY, and process tree continue running indefinitely, including for a singleton workspace.
- A three-second toast offers **Reconnect `⌘Z`** and **Kill `⌘W`**. Pressing `⌘W` again while the toast is visible kills the disconnected session.
- The status bar counts sessions that are not attached to Desktop. Its item and `⌘K` → **Sessions…** open the same workspace-scoped panel, which lists sessions by their durable native `workspace_id` membership, this Desktop's attachment state, connected clients, and control owner. Legacy records without membership temporarily fall back to launch-directory containment. Return attaches, detaches, or takes control as appropriate; Delete or `⌘W` kills the selection.
- `⇧⌘T` reconnects the latest disconnected terminal in the selected workspace and restores its former position.
- Disconnected terminals persist across a Desktop restart. If Desktop's private manifest is lost, it reconstructs local native workspaces automatically; selecting a registered SSH directory does the same remotely. Reconnection creates a fresh Ghostty renderer from the worker's latest visible screen rather than restoring renderer-owned scrollback, selection, or viewport state.
- In Navigate mode's workspace overview, `⌘W` still confirms before closing the workspace and killing all of its sessions.
- Files in working directories are never deleted.

## Automated interaction check

The in-process interaction runner sends keyboard events through the actual
palette and confirmation views, and checks state through the same local API used
by automation clients:

```sh
./prepare-ghostty.sh
swift run MachinenDesktop --interaction-tests
```

Set `MACHINEN_STATUS_PREVIEW_PATH=/tmp/machinen-status.png` to also save the
offscreen graphical status-bar fixture for visual review.

It covers the explicit `⌘N` chooser, `⌘↓`/`⌘↑` hierarchy navigation, and
keyboard-driven workspace creation, rename, and close.
