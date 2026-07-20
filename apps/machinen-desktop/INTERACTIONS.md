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
The terminal fills the viewport and receives keyboard focus.

## Navigation

| Input            | Behavior                                             |
| ---------------- | ---------------------------------------------------- |
| `⌘↓` or `Return` | Move one level in.                                   |
| `⌘↑`             | Move one level out.                                  |
| `⌘←` / `⌘→`      | From a focused terminal, cycle within its workspace. |
| Arrow keys       | Move the selection at the current overview level.    |
| Single click     | Select; a singleton workspace enters immediately.    |
| Double click     | Enter the selected workspace or terminal.            |
| Hold Space       | Momentarily peek into the selection.                 |

Focused-terminal cycling wraps at both ends and moves the camera directly to
the previous or next live terminal in 120 ms. It does not zoom out through the
workspace deck, reorder tiles, or restart terminal surfaces.

Machinen never interprets an unmodified Escape while a terminal is focused. The
byte goes directly to the PTY, so terminal programs retain their normal Escape
behavior.

## Creating terminals and workspaces

`⌘N` follows the current spatial context:

- In the workspace overview, it creates a uniquely generated workspace with one
  login-shell terminal and enters it.
- Inside a workspace or focused terminal, it creates another login-shell
  terminal in that workspace. The new terminal inherits the selected terminal's
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
continues while the viewer is detached. Waiting terminals use the attention
color and workspace headers aggregate `waiting > active > unknown > idle`.

## Programmable status bar

The breadcrumb is fixed. Programs can publish scoped text, count, state,
progress, timer, sparkline, and separator widgets through `status.set`,
`status.list`, and `status.remove`. Workspace widgets override global widgets;
terminal widgets override workspace widgets with the same ID. TTLs remove stale
live data. Built-in waiting, active, idle, and failed counts use the same visual
primitives.

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

It covers contextual `⌘N`, `⌘↓`/`⌘↑` hierarchy navigation, wrapping
`⌘←`/`⌘→` focused-terminal cycling, and keyboard-driven workspace creation,
rename, and close.
