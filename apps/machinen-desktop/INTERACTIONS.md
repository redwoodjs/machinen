# Machinen Desktop interaction contract

Machinen presents one persistent spatial scene. Navigation moves a camera over
live terminal surfaces; it does not rebuild, hide, crossfade, or reflow them.

## Hierarchy

```text
workspace overview
└── workspace
    └── terminal
        └── persistent PTY process
```

A workspace with one terminal skips the redundant workspace level when entered.
The terminal fills the viewport and receives keyboard focus. Each workspace is
bound to one persisted working directory; terminal launchers, Git instruments,
and local service discovery use that directory as their project boundary.

## Navigation

| Input            | Behavior                                              |
| ---------------- | ----------------------------------------------------- |
| `⌘↓` or `Return` | Move one level in.                                    |
| `⌘↑`             | Move one level out.                                   |
| `⌘←` / `⌘→`      | From a focused terminal, cycle across live terminals. |
| Arrow keys       | Move the selection at the current overview level.     |
| Single click     | Select; a singleton workspace enters immediately.     |
| Double click     | Enter the selected workspace or terminal.             |
| Hold Space       | Momentarily peek into the selection.                  |

Focused-terminal cycling follows tile order within each workspace, then crosses
to the next or previous workspace in spatial order. It wraps across the entire
terminal ring and moves the camera directly to the destination in 120 ms. It
does not zoom out through a workspace deck, reorder tiles, or restart terminal
surfaces.

`⌘↑` moves only the camera hierarchy; it does not change terminal scrollback.
The terminal viewport keeps the same intrinsic bounds while the camera moves, so
leaving a focused terminal cannot resize, reflow, or shift its scroll position.

Machinen never interprets an unmodified Escape while a terminal is focused. The
byte goes directly to the PTY, so terminal programs retain their normal Escape
behavior.

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

`⌘K` contains exactly three workspace actions:

1. **New workspace…** asks for a name, creates an initial login-shell terminal,
   and enters it.
2. **Rename workspace…** changes the visible name while preserving the stable
   workspace ID and all terminals.
3. **Close workspace…** asks for confirmation, terminates its PTY processes,
   and removes its saved workspace and terminal definitions.

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

The bundled dtach master writes only counters and process/terminal metadata to a
private `0600` sidecar. It never buffers output content. Detection therefore
continues while the viewer is detached. For sessions created by an older dtach
helper, Machinen discovers the existing master, foreground process group, and
terminal mode from the local process table and observes live viewer output. This
compatibility path upgrades activity reporting without restarting the command.
The single status bar renders terminals as spatially ordered activity pips;
waiting and failed terminals receive attention and error tones.

## Programmable status bar

Machinen has one persistent status bar. At workspace level its title is the
workspace name and hovering it reveals the bound path. At terminal level the
title becomes the automatically observed foreground command. An MCP client can
set a persistent title override with `terminal_update`, or clear it to return to
automatic detection.

The top-right strip is graphical at rest: terminal activity uses spatially
ordered pips, Git changes use paired diff bars, system CPU uses an area graph,
host network transfer uses mirrored lines, progress uses a ring, and listening
project services use health rings. Hover reveals labels and exact values.

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

It covers contextual `⌘N`, `⌘↓`/`⌘↑` hierarchy navigation, wrapping
`⌘←`/`⌘→` focused-terminal cycling, and keyboard-driven workspace creation,
rename, and close.
