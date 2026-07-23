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

A **workspace** owns a persisted location—either a local folder or an SSH host
plus remote folder—and workspace-scoped status items. A **tile** is the spatial object that is moved between workspaces; it
links the terminal to its current foreground process PID. A **terminal** owns
the launch configuration, emulator, and persistent PTY. A workspace with one
tile skips the redundant workspace level when entered; its tile fills the entire
workspace surface. Terminal launchers, Git instruments, and local service
discovery use the workspace directory as their project boundary.

## Navigation

| Input            | Behavior                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `⌘↓` or `Return` | Move one level in.                                                                                                 |
| `⌘↑`             | Move one level out.                                                                                                |
| `⌘←` / `⌘→`      | From a focused terminal, select the previous/next workspace and focus its first tile through the camera hierarchy. |
| `⌘K`             | Open workspace commands, including local or SSH location editing.                                                  |
| Keyboard input   | A focused terminal receives all other keys and modifier combinations.                                              |
| Arrow keys       | Move the selection only at the current overview level.                                                             |
| Click            | A terminal preview focuses its terminal.                                                                           |
| Drag preview     | Move a terminal tile to the workspace under the drop point.                                                        |
| Drag terminal    | Forward the drag for terminal selection/input.                                                                     |
| Hold Space       | Momentarily peek into the selection.                                                                               |

## Input modes

- **Workspace overview:** no terminal is focused. Terminal previews can be
  click-dragged to another workspace; workspace cards can be dragged to reorder
  workspaces.
- **Workspace deck:** no terminal is focused. Terminal previews can be dragged
  to reorder them inside that workspace.
- **Focused terminal:** the viewport owns every pointer and keyboard event.
  Spatial dragging, overview navigation, and application command equivalents do
  not intercept terminal input, except `⌘←` / `⌘→` and `⌘K`. The arrow
  shortcuts animate a distinct path: zoom out to the source workspace, zoom out
  to the workspace overview and select the adjacent workspace, then zoom into
  that workspace and its first tile. `⌘K` opens workspace metadata commands
  without changing camera level.

`⌘↑` moves only the camera hierarchy; it does not change terminal scrollback.
The terminal viewport keeps the same intrinsic bounds while the camera moves, so
leaving a focused terminal cannot resize, reflow, or shift its scroll position.

Machinen never interprets an unmodified Escape while a terminal is focused. The
byte goes directly to the PTY, so terminal programs retain their normal Escape
behavior. `⌘C` copies the current terminal selection, `⌘V` pastes plain text
into the focused terminal, and `⌘A` selects its terminal buffer.

In the workspace overview, drag a terminal preview onto another workspace to
move the tile there; the destination workspace highlights while it is a drop
target. The persistent PTY is not restarted. Once inside a workspace, the
terminal viewport is an input surface: clicks, drags, and keyboard shortcuts go
to its terminal. Workspace cards retain spatial dragging in overview; a short
click never becomes a drag, and the source fades only after a five-point
movement threshold.

## Creating terminals and workspaces

`⌘N` follows the current spatial context:

- In the workspace overview, it creates a uniquely generated workspace with one
  login-shell terminal and enters it.
- Inside a workspace or focused terminal, it creates another login-shell
  terminal in that workspace. The new terminal inherits the workspace's bound
  working directory.

`⌘T` opens the terminal launcher. It can create a login shell, run an arbitrary
command, or choose a folder for another workspace.

## Workspace commands

`⌘K` contains exactly four workspace actions:

1. **New workspace…** asks for a name, creates an initial login-shell terminal,
   and enters it.
2. **Rename workspace…** changes the visible name while preserving the stable
   workspace ID and all terminals.
3. **Change workspace location…** chooses either a local folder or a remote
   `host:/absolute/path` reachable through the user's SSH configuration, then
   rebinds the workspace and its saved terminal launch definitions.
4. **Close workspace…** asks for confirmation, terminates its PTY processes,
   and removes its saved workspace and terminal definitions.

Changing a workspace location does not move files or alter the current directory
of an already-running process. New terminals and restarted terminals use the new
location. For an SSH location, Machinen installs its small native session helper
on the SSH host and the remote worker owns the PTY in the selected folder. The
local SwiftTerm view attaches through SSH, so closing Desktop or losing the SSH
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

Machinen separates PTY lifecycle from activity. Running terminals are reported
as `working`, `waiting`, `idle`, or `unknown`:

- recent PTY input/output is working;
- a login shell at its own foreground process group is idle;
- after a foreground command becomes quiet, Machinen samples its wait state;
- terminal reads and raw interactive event loops become waiting after two
  matching observations;
- timers, child-process waits, and network waits remain working;
- stopped, exited, or unreadable sessions are unknown.

The native session worker journals byte-exact output and ordered resize events
to a private SQLite database, allowing a new renderer to recover history after
a disconnect. Sessions created by an older Desktop manifest continue through
the bundled dtach compatibility backend until explicitly restarted; Machinen
discovers their existing master and foreground process group without disrupting
the command. Detailed detached-process activity metadata for the native backend
will move behind the session protocol rather than depending on dtach sidecars.
The single status bar renders terminals as spatially ordered activity pips;
waiting and failed terminals receive attention and error tones.

## Programmable status bar

Machinen has one persistent status bar. At workspace level its title is the
workspace name and hovering it reveals the bound path. At terminal level the
title is `workspace name > terminal name`; its hover detail shows the bound path
and observed foreground command. For login shells, Machinen infers the terminal
name from dtach's persistent child process (for example, `zsh` or `bash`). An
MCP client can set a persistent title override with `terminal_update`, or clear
it to return to automatic detection. A terminal program can set a temporary
runtime label with OSC 2 `machinen:<label>` (and clear it with `machinen:`);
that label takes precedence in the status title, survives a viewer relaunch, and
works through SSH.

The macOS **View** menu contains **Show Debug Information**, which presents the
current workspace or terminal's diagnostics without interrupting its PTY.

The top-right strip is graphical at rest. In a **workspace**, it summarizes
that workspace's tiles: aggregate tile CPU, aggregate tile network transfer,
Git changes, and visible active/idle/waiting tile counts. In a **focused tile**,
it shows that tile's foreground PID (shown as `PID ####` and copyable with a
click), CPU for that PID and its local child processes, network transfer for
that PID and its local child
processes, workspace Git changes, and the tile's active/idle/waiting state. Git
and service items are scoped to the selected workspace. CPU is sampled through
`proc_pid_rusage`; network bytes come from macOS `nettop`. Tile activity is a
label-free graphical indicator; hover reveals its exact state summary.

Programs can publish scoped text, count, state, progress, timer, sparkline, and
separator widgets through `status.set`, `status.list`, and `status.remove`.
Sparklines accept line, area, bars, and mirrored styles with primary and
secondary sample arrays. State widgets accept arrays of semantic pip states.
Workspace widgets override global widgets; terminal widgets override workspace
widgets with the same ID. TTLs remove stale live data.

## Closing

`⌘W` never closes Machinen's macOS window:

- In a workspace with multiple terminals, it closes the selected terminal.
- In the workspace overview or a singleton workspace, it closes the workspace.
- `Return` confirms and `Esc` cancels.
- Closing terminates the affected process and removes its saved definition.
- Files in working directories are never deleted.

## Automated interaction check

The in-process interaction runner sends keyboard events through the actual
palette and confirmation views, and checks state through the same local API used
by MCP:

```sh
swift run MachinenDesktop --interaction-tests
```

Set `MACHINEN_STATUS_PREVIEW_PATH=/tmp/machinen-status.png` to also save the
offscreen graphical status-bar fixture for visual review.

It covers contextual `⌘N`, `⌘↓`/`⌘↑` hierarchy navigation and keyboard-driven
workspace creation, rename, and close.
