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
cache. Desktop has one implicit local target plus explicit persisted SSH target
profiles. It polls only those targets; discovery updates the session browser and
never creates a workspace, tile, viewer, or camera transition. A **tile** is the
spatial object reordered within that workspace; it links the terminal to its
current foreground process PID. A **terminal** owns
the launch configuration, emulator, and persistent PTY. A workspace with one
tile skips the redundant workspace level when entered; its tile fills the entire
workspace surface. Terminal launchers, Git instruments, and local service
discovery use the workspace directory as their project boundary.

## Navigation

| Input            | Behavior                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- |
| `⌘+` / `⌘−`      | Magnify/demagnify the camera in equal increments without changing hierarchy level. |
| `⌘0`             | Reset camera magnification to actual size without changing hierarchy level.        |
| `⌘,`             | Open the Desktop settings file in the user's default editor.                       |
| `⇧⌘↓` or Return  | Enter the selected workspace or pane.                                              |
| `⇧⌘↑`            | Leave the current pane or workspace.                                               |
| `⇧⌘←` / `⇧⌘→`    | From Terminal mode, focus the previous/next pane in the current workspace.         |
| `⇧⌘[` / `⇧⌘]`    | From Terminal mode, focus the active pane in the previous/next workspace.          |
| `⌘N` / `⇧⌘N`     | Enter map edit mode, select the current creation tile, and enter that tile.        |
| `⌘K` / `⇧⌘K`     | Open commands for the current and containing spaces.                               |
| `⌘E` or `⇧⌘E`    | Open or close the action overlay for the visible map level.                        |
| `⌘O`             | Show the focused terminal's full context menu.                                     |
| `⌘W`             | Enter the selected tile and verify its removal before any state changes.           |
| Keyboard input   | In Terminal mode, the terminal receives all other keys and modifier combinations.  |
| Arrow keys       | Move the selection only at the current overview level.                             |
| `⇧` + arrows     | Reorder the selected pane or workspace in the chosen direction.                    |
| Click            | A terminal preview focuses its terminal.                                           |
| Right-click      | Show Copy, Paste, Select All, and the **Open Selection With** submenu.             |
| Drag preview     | Inside a workspace, reorder its terminal tiles. Never change their workspace.      |
| Drag terminal    | Forward the drag for terminal selection/input.                                     |
| Hold Space       | Momentarily peek into the selection.                                               |
| Two-finger swipe | Select a map tile and pan the camera in the swipe direction.                       |
| Three-finger ↑/↓ | Leave one camera level or enter the highlighted object.                            |
| Three-finger ←/→ | Pan between sibling terminals, workspaces, or overview tiles.                      |

Machinen writes the spatial shortcuts to `~/.config/machinen/config.json` on
first launch and adds new defaults to older files. The actions are `enter`,
`leave`, `selectLeft`, `selectRight`, `selectDown`, `selectUp`, `moveLeft`,
`moveRight`, `moveDown`, `moveUp`, `previousPane`, `nextPane`,
`previousWorkspace`, and `nextWorkspace`. The file is read when Desktop starts.

Machinen writes its intent policy to `~/.config/machinen/interactions.json`.
The application menu can open this file. **Reload Interaction Policy** loads a
valid change without a rebuild or restart. Desktop never polls the file. Each
rule maps a level and `edit`, `new`, or `close` intent
to a spatial target, inline panel, camera policy, and approved native effect.
The engine rejects duplicate rules, missing rules, unknown values, and panel or
effect mismatches. It keeps the last valid policy after an error. An active edit
session retains the policy version that opened it. The next edit session uses
the new version.

The engine supports `none`, `directIfNeeded`, and `parentLevel` camera policies.
`cameraDurationMilliseconds` changes the shared transition time. One rule supplies
one final camera target. `directIfNeeded` skips motion when the
camera already matches that target. Native Swift code retains Escape restoration,
destructive verification, effect approval, and workspace ownership checks.

## Input modes

- **Navigate mode:** no terminal is focused. It has two camera levels:
  - **Workspace overview:** unlabeled workspace cards contain terminal previews
    that do not move out of them; cards can be dragged to reorder workspaces.
  - **Workspace deck:** terminal previews can be dragged to reorder them inside
    that workspace.
- **Terminal mode:** one terminal is focused, and its viewport owns every
  pointer and keyboard event. Spatial dragging, overview navigation, and
  application command equivalents do not intercept terminal input, except
  `⌘+` / `⌘−`, the configured Desktop shortcuts, `⌘N` / `⇧⌘N`, `⌘K` / `⇧⌘K`, `⌘O`, and three-finger swipes.
  `previousPane` and `nextPane` wrap through the terminals in the current
  workspace by panning the camera directly at a fixed zoom without leaving
  Terminal mode. `previousWorkspace` and `nextWorkspace` wrap through
  non-empty workspaces with a short directional slide and fade from the current
  pane to the adjacent workspace's last active pane. Each visible slide keeps a
  fixed zoom; at the faded midpoint, the destination adopts its normal fitted
  framing. The camera never visits the workspace overview during the transition.
  Pane and workspace transitions temporarily show a minimap at the top right,
  directly below the status bar. It
  preserves the scene's exact workspace and pane geometry under one uniform
  scale and animates the camera viewport from source to destination. It remains
  fully visible for 1.25 seconds at the destination, then fades over 340 ms. A
  persistent 56×26-point status item sits at the far right after the version.
  It keeps exact workspace and pane placement but simplifies each pane to a
  square pixel-snapped outline, with one-pixel gutters that make pane and
  workspace counts legible. Pane outline intensity also carries activity:
  working is bright, idle is muted, waiting is dashed, and unknown is faint.
  The large transient map uses the exact same monochrome, unfilled pixel-art
  treatment and discrete camera steps. Both maps keep square internal geometry
  inside a rounded outer card; only their size and placement differ. Hovering
  the compact map reveals the large map at full opacity; leaving dismisses that
  read-only preview with the normal fade.
  `⌘K` or `⇧⌘K` opens context-aware commands without changing camera level. `⌘O` opens
  the focused terminal's full context menu, including its **Open Selection
  With** submenu when text is selected.

`⌘+` / `⌘−` changes only camera magnification in equal increments, and `⌘0` resets it to actual size; all preserve the current hierarchy level. The configured `enter` and `leave` actions move through the camera hierarchy. A two-finger swipe selects and pans between spatial tiles only in Navigate mode. Terminal mode keeps two-finger scroll for terminal history. Three-finger up and down swipes leave and enter camera levels. A down swipe enters the tile below the mouse pointer, or the highlighted tile when no tile is below it. Three-finger horizontal swipes pan between sibling objects. The camera follows finger distance without easing while the fingers stay down. Release at 35 percent or more completes the transition. An earlier release restores the source camera. Desktop consumes all three-finger scroll events before a terminal receives them. A new swipe replaces active camera motion. No swipe changes terminal scrollback.
The terminal viewport keeps the same intrinsic bounds and Ghostty grid while the
camera moves. Navigate mode shows a scaled version of that unchanged surface;
it does not resize or reflow the terminal. Leaving Terminal mode therefore
cannot shift its content or scroll position.

When several Desktops view the same native session, the PTY keeps one
controller-owned rows-by-columns grid. Watchers fit and letterbox that grid in
their own differently sized tiles; they do not resize or reflow it. A lone
viewer follows its own dimensions automatically. **Sessions…** labels
the owner and offers **Control** to an attached watcher.

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

`⌘N` enters the visual creation path for the current map level. In the workspace
overview, it opens edit mode, selects the **Add Workspace** tile, and enters its
form. At workspace or terminal level, it opens workspace edit mode, selects the
**New Terminal** tile, and enters terminal creation. Opening or cancelling the
flow does not change persisted state.

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

Escape leaves the active creation view without a persisted change. Picking a
registered location restores its workspace; a location without a native record
creates a new one.

**SSH is a workspace location, not a special terminal type.** The SSH flow asks
for an OpenSSH host or alias (for example `mini` or `peter@server`) and then a
remote folder (for example `~/gh/project` or `/srv/project`). Machinen stores the
pair as `host + remote root`, validates it through the user's OpenSSH
configuration, and every terminal created in that workspace inherits it. The
remote browser lists one directory level at a time over SSH, starting at the
remote user's `$HOME`.

The **New Terminal** tile contains its blue creation panel. It can create a login
shell or run an arbitrary command without a detached palette. The same choices
remain available as a nested **New terminal…** command under `⌘K`. There is no
separate `⌘T` launcher.

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

`⌘K` and the application menu's **Commands…** open commands for the current
camera space and its containing spaces. `⌘E` or `⇧⌘E` opens an action overlay
above the visible map. The overlay keeps cards visible and shows only actions for
the current level. Escape, `⌘E`, and `⇧⌘E` close the overlay.

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
2. **New workspace…** opens its location-then-name command flow, creates an
   initial login-shell terminal, and enters it.
3. **New terminal…** opens nested choices for a login shell, an arbitrary
   command, or a new workspace from a folder.
4. **Rename workspace…** changes the visible name while preserving the stable
   workspace ID and all terminals.
5. **Change workspace location…** chooses either a local folder or a remote
   `alias:path` reachable through the user's SSH configuration. It is available
   at any time, including while terminals are running.
6. **Sessions…** opens the app-wide computer → workspace → session
   tree. Session rows show this Desktop's attachment state, connected-client
   count, and control state. Return attaches or detaches normally; when this
   Desktop is an attached watcher, Return takes writer and resize control while
   leaving the previous controller connected. Delete or `⌘W` kills the session.
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
Desktop-side process-list guess. Both spatial minimaps mirror terminal activity
directly onto their pane outlines. They remain useful as idle and working
indicators without rearranging the scene.

## Top bar

Machinen has one persistent status bar. Its breadcrumb is `Workspaces`,
`Workspaces > workspace`, or `Workspaces > workspace > terminal`. Choosing
`Workspaces` returns to the overview. The workspace segment is a dropdown of all
workspaces in spatial order. Choosing its current workspace moves the camera one
level out; choosing another workspace enters that workspace with the same slide
and fade used by workspace shortcuts. At terminal level, the terminal segment is
a second dropdown of that workspace's terminals in spatial order, so choosing
one focuses it with the same fixed-zoom pan used by pane shortcuts. Hovering either
title reveals its bound path,
and terminal hover detail also shows any observed foreground command. An API
client can set a persistent title
override with `terminal.update`, or clear it to return to the saved terminal
name. A terminal program can set a temporary
runtime label with OSC 2 `machinen:<label>` (and clear it with `machinen:`);
that label takes precedence in the status title, survives a viewer relaunch, and
works through SSH.

The macOS **View** menu contains **Show Debug Information**, which presents the
current workspace or terminal's diagnostics without interrupting its PTY.

The top-right strip contains only the build version and the persistent spatial
minimap. The version identifies the app bundle and the bundled session handler.
No published status widget appears in the top bar. The strip occupies its own
layout row, so terminal content never renders underneath it.

Programs can publish scoped status data through `status.set`, `status.list`, and
`status.remove`. Machine data overrides global data. Workspace data overrides
machine data. Terminal data overrides workspace data with the same identifier.
A TTL removes stale data. This data remains available through the API.

## Hosts across computers

Status items open the host browser. The browser uses host → workspace → terminal
→ action. Type to filter the visible level. Use arrows and Return to move in.
Use Escape to move out. Click a row to select it. The browser owns View, Take
Control, and Detach. Machinen has no separate user-facing session manager.
**Add Host…** accepts an OpenSSH alias or `user@host` and retains the existing
OpenSSH/helper behavior.

**Add Workspace…** chooses a computer, folder, and name, then saves the native
workspace record without opening it or creating a terminal. Enter on a workspace
explicitly opens it; Enter on a session explicitly attaches it. Each workspace
row has its own **Close** action. Closing removes only that native workspace and
its sessions, with a three-second **Undo** window before the close is committed
on the owning computer. Stopping use of another computer is a separate confirmed
action and never deletes or syncs its `sessions.sqlite3`, PTYs, or output.

A computer is **online** when polling finds active sessions, **inactive** when it
responds with none, and **unreachable** when the last poll failed; unreachable is
retained separately from inactive. Each computer has at most one poll in flight,
and repeated failures use bounded backoff. Matching names or paths never merge
workspace identities.

## Map edit overlay

`⌘E` or `⇧⌘E` opens an action overlay above the current map. The map stays visible. At
the overview level, each workspace card shows its own **Close** control. A blue
dashed **Add Workspace** card creates a workspace only after a user selects it.
The camera enters this card. A centered search panel uses the command palette
style. Type to filter known workspace locations. Existing workspaces remain
visible as disabled results. Select an available location, then enter its name.
`⌘⇧↑` leaves the active form and returns to the edit overview. The Add Workspace
tile stays selected. This flow never opens the command palette.

A muted dashed ghost card represents a discovered workspace that is not attached
to this Desktop. Existing, ghost, and Add Workspace cards are ordinary workspace
tiles. The latter two use alternate tile rendering modes. All tiles use the same
layout, selection state, configured spatial shortcuts, mouse input, and Return
action. One click enters a creation tile. A double-click does the same. Select a
ghost card to attach its workspace.

At the workspace level, `⌘E` or `⇧⌘E` keeps the workspace visible. A blue dashed
**New Terminal** tile uses the ordinary tile layout and input. One click or
Return enters a centered blue creation panel inside that tile. The overlay offers **Rename Workspace** and **Close
Workspace**. In terminal mode, the same shortcut always moves one level to the
containing workspace. It then adds the New Terminal tile. The terminal count does
not change this rule.

In workspace mode, `⇧⌘[` and `⇧⌘]` move to the previous or next workspace. The
camera stays at the workspace level, and the workspace list wraps. A hierarchy
change from a keyboard shortcut keeps edit mode active. A click on a real tile
exits edit mode before normal tile navigation. The overview replaces terminal
actions with Add Workspace and workspace removal actions. Entry into a workspace restores New
Terminal and terminal actions without terminal focus. Machinen exits map edit
mode after any new terminal tile enters the workspace. Detach and Kill
remain available through normal terminal commands. Escape, `⌘E`, and `⇧⌘E` close
the overlay. They restore the workspace, tile selection, terminal focus, and map
level that opened edit mode.

## Disconnecting and killing

`⌘W` never closes Machinen's macOS window:

- Inside a workspace, `⌘W` stays at the current level and targets only the highlighted terminal tile. It does not enter general edit mode or add temporary tiles. A red verification panel appears inside that tile. No state changes before Return confirms the action. Confirmation removes the tile and disconnects its viewer. The native session, PTY, and process tree continue running indefinitely, including for a singleton workspace. If a terminal has focus, the camera returns to the workspace map. Machinen never focuses the next terminal automatically.
- In the workspace overview, `⌘W` targets only the highlighted workspace tile and shows the same local verification model before workspace removal.
- A three-second toast offers **Reconnect `⌘Z`** and **Kill `⌘W`**. Pressing `⌘W` again while the toast is visible kills the disconnected session.
- The status bar counts sessions that are not attached to Desktop. Its item and `⌘K` → **Sessions…** open the app-wide session browser with attachment, client, and control state. Return attaches, detaches, or takes control as appropriate; Delete or `⌘W` kills a selected session.
- `⇧⌘T` reconnects the latest disconnected terminal in the selected workspace and restores its former position.
- Disconnected terminals persist across a Desktop restart. If Desktop's private manifest is lost, discovery shows native workspaces and sessions on This Mac and explicitly used computers but does not reconstruct the spatial scene. The user must explicitly open a workspace and explicitly attach a session. Reconnection creates a fresh Ghostty renderer from the worker's latest visible screen rather than restoring renderer-owned scrollback, selection, or viewport state.
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

It covers the spatial `⌘N` creation path, `⌘↓`/`⌘↑` hierarchy navigation, and
keyboard-driven workspace creation, rename, and close.
