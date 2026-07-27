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

A **workspace** uniquely owns a persisted location—either a local folder or an
SSH host plus remote folder—and workspace-scoped status items. A **tile** is the
spatial object reordered within that workspace; it links the terminal to its
current foreground process PID. A **terminal** owns
the launch configuration, emulator, and persistent PTY. A workspace with one
tile skips the redundant workspace level when entered; its tile fills the entire
workspace surface. Terminal launchers, Git instruments, and local service
discovery use the workspace directory as their project boundary.

## Navigation

| Input            | Behavior                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| `⌘↓` or `Return` | Move one level in.                                                                     |
| `⌘↑`             | Move one level out.                                                                    |
| `⌘←` / `⌘→`      | From Terminal mode, focus the previous/next terminal in the current workspace.         |
| `⌘[` / `⌘]`      | From Terminal mode, focus the first terminal in the previous/next non-empty workspace. |
| `⌘N`             | Open the New chooser; never create a terminal or workspace immediately.                |
| `⌘K`             | Open workspace commands, including local or SSH location editing.                      |
| Keyboard input   | In Terminal mode, the terminal receives all other keys and modifier combinations.      |
| Arrow keys       | Move the selection only at the current overview level.                                 |
| Click            | A terminal preview focuses its terminal.                                               |
| Drag preview     | Inside a workspace, reorder its terminal tiles. Never change their workspace.          |
| Drag terminal    | Forward the drag for terminal selection/input.                                         |
| Hold Space       | Momentarily peek into the selection.                                                   |

## Input modes

- **Navigate mode:** no terminal is focused. It has two camera levels:
  - **Workspace overview:** terminal previews identify their workspace but do
    not move out of it; workspace cards can be dragged to reorder workspaces.
  - **Workspace deck:** terminal previews can be dragged to reorder them inside
    that workspace.
- **Terminal mode:** one terminal is focused, and its viewport owns every
  pointer and keyboard event. Spatial dragging, overview navigation, and
  application command equivalents do not intercept terminal input, except
  `⌘←` / `⌘→`, `⌘[` / `⌘]`, `⌘N`, and `⌘K`. The arrow shortcuts wrap through the
  terminals in the current workspace, zooming out to the workspace before
  focusing the adjacent terminal. The bracket shortcuts wrap through non-empty
  workspaces: they zoom out to the source workspace, zoom out to the workspace
  overview and select the adjacent workspace, then zoom into its first tile.
  `⌘K` opens workspace metadata commands without changing camera level.

`⌘↑` moves only the camera hierarchy; it does not change terminal scrollback.
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

Creating a workspace always asks where it lives before creating its first
terminal:

1. **Choose a location.** The user can open a location already known to
   Machinen, browse for a local folder, or choose **SSH host…**. A known
   location opens its existing workspace and reattaches its saved terminals;
   Machinen never creates two workspaces for the same canonical location.
2. **Name a new workspace.** The folder name is offered as a default for local
   workspaces; the remote folder name is offered for SSH workspaces. The name
   remains editable and follows the workspace naming rules below.
3. Machinen creates the workspace, creates its initial login-shell terminal,
   and enters it.

A local browser can select an existing directory or create a directory. Picking
a known location opens its workspace; it does not move, copy, or delete files.

**SSH is a workspace location, not a special terminal type.** The SSH flow asks
for an OpenSSH host or alias (for example `mini` or `peter@server`) and then a
remote folder (for example `~/gh/project` or `/srv/project`). Machinen stores the
pair as `host + remote root`, validates it through the user's OpenSSH
configuration, and every terminal created in that workspace inherits it. A
first version does not need a remote folder browser: entering the remote path is
the definition of the location.

`⌘T` remains the terminal launcher for the selected workspace. It can create a
login shell or run an arbitrary command, but it does not replace `⌘N`'s explicit
workspace chooser.

## Workspace commands

`⌘K` contains exactly four workspace actions:

1. **New workspace…** opens the same location-then-name flow used by `⌘N`,
   creates an initial login-shell terminal, and enters it.
2. **Rename workspace…** changes the visible name while preserving the stable
   workspace ID and all terminals.
3. **Change workspace location…** chooses either a local folder or a remote
   `alias:path` reachable through the user's SSH configuration. A workspace's
   location can change only after all of its terminal definitions are removed.
4. **Close workspace…** asks for confirmation, terminates its PTY processes,
   and removes its saved workspace and terminal definitions.

An SSH workspace is entered as `alias:~/folder`, `alias:/absolute/folder`, or
`user@host:/absolute/folder`. The host can be any alias understood by the user's
OpenSSH configuration. Machinen checks the connection and resolves the remote
folder before creating or rebinding the workspace; the folder must already
exist.

Machinen rejects a location already owned by another workspace and rejects
location changes while the workspace contains terminals. It never rewrites a
running terminal's location. For an SSH location, Machinen installs its small native session helper
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
for the foreground process group: the foreground login shell is `idle`, while a
foreground command is `working`. Recent output also reports `working`.
Live pre-telemetry workers use a compatibility fallback: recent viewer output is
`working`, while a quiet persistent session is `idle`. Stopped, exited, or
unreadable sessions remain `unknown` unless a trusted API client supplies a
stronger state through `tile.update`.

The worker publishes shell and foreground PIDs, process names, and activity over
its private native protocol while continuing to journal byte-exact output and
ordered resize events to SQLite. This works for attached, detached, local, and
SSH sessions because observation happens beside the PTY rather than through a
Desktop-side process-list guess. The status bar renders terminals as spatially
ordered activity pips; waiting and failed terminals receive attention and error
tones.

## Programmable status bar

Machinen has one persistent status bar. At workspace level its title is the
workspace name and hovering it reveals the bound path. At terminal level the
title is `workspace name > terminal name`; its hover detail shows the bound path
and any observed foreground command. An API client can set a persistent title
override with `terminal.update`, or clear it to return to the saved terminal
name. A terminal program can set a temporary
runtime label with OSC 2 `machinen:<label>` (and clear it with `machinen:`);
that label takes precedence in the status title, survives a viewer relaunch, and
works through SSH.

The macOS **View** menu contains **Show Debug Information**, which presents the
current workspace or terminal's diagnostics without interrupting its PTY.

The top-right strip is graphical at rest. Its activity monitor always summarizes
all terminals in the selected workspace, with visible active/idle/waiting tile
counts even while one terminal is focused. In a **workspace**, the strip also
shows aggregate tile CPU, aggregate tile network transfer, and branch-wide Git
changes. The Git item shows only the total changed-file count at rest; hovering
reveals the branch, commits since its default-branch merge base, changed files,
and added and deleted lines. In a **focused tile**, it shows that tile's
foreground PID (shown as `PID ####` and copyable with a click), CPU for that PID
and its local child processes, network transfer for that PID and its local child
processes, workspace branch changes, and the workspace activity monitor. Git is
scoped to the selected workspace. Open ports include listeners whose process
working directory is the selected workspace folder or one of its descendants,
on either the local Mac or the workspace's SSH host. Hover lists each TCP
listener on its own line with the process and bind address;
clicking the instrument presents those listeners, and choosing one opens its
HTTP URL through the default macOS handler. Trusted TypeScript desktop services
publish activity, Git, ports, CPU, network, and PID widgets through the local
API. Process network bytes come from macOS `nettop`. Tile activity is a
label-free graphical indicator; hover
reveals its exact state summary.

Programs can publish scoped text, count, state, progress, timer, sparkline, and
separator widgets through `status.set`, `status.list`, and `status.remove`.
Sparklines accept line, area, bars, and mirrored styles with primary and
secondary sample arrays. State widgets accept arrays of semantic pip states.
Machine widgets override global widgets, workspace widgets override machine
widgets, and terminal widgets override workspace widgets with the same ID. TTLs
remove stale live data.

## Closing and undo

`⌘W` never closes Machinen's macOS window:

- In a workspace with multiple terminals, it immediately removes the selected terminal from the scene and buffers the close for five minutes.
- The buffered terminal keeps the same persistent PTY, process tree, Ghostty surface, scrollback, selection, and viewport while Desktop remains open.
- `⇧⌘T` or the close banner's **Undo** restores that same terminal and its former position.
- **Terminate now** makes a buffered close irreversible immediately. Otherwise Machinen stops and deletes the native session when the five-minute deadline expires.
- At most five recently closed terminals retain resources; closing another finalizes the oldest one.
- In Navigate mode's workspace overview or a singleton workspace, `⌘W` still confirms before closing the workspace and all of its terminals.
- Pending closes persist across a Desktop restart, although a newly created Ghostty surface can restore only the worker's latest visible screen rather than renderer-owned scrollback or viewport state.
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
