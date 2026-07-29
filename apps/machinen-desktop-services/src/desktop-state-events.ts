import type {
  DesktopEvent,
  DesktopUIState,
  Terminal,
  Tile,
  Workspace,
} from "@machinen/desktop-sdk";

interface MutableDesktopState {
  readonly workspaces: Map<string, Workspace>;
  readonly tiles: Map<string, Tile>;
  readonly terminals: Map<string, Terminal>;
  ui: DesktopUIState;
}

export function applyDesktopEvent(state: MutableDesktopState, event: DesktopEvent): void {
  if (event.event.startsWith("workspace.")) {
    applyWorkspaceEvent(state, event);
    return;
  }
  if (event.event.startsWith("tile.")) {
    applyTileEvent(state, event);
    return;
  }
  if (event.event.startsWith("terminal.")) {
    applyTerminalEvent(state, event);
    return;
  }
  if (event.event === "ui.changed") {
    applyUIEvent(state, event);
  }
}

function applyWorkspaceEvent(state: MutableDesktopState, event: DesktopEvent): void {
  const workspace = event.data as unknown as Workspace;
  if (event.event === "workspace.deleted") {
    if (typeof workspace.id === "string") {
      state.workspaces.delete(workspace.id);
    }
    return;
  }
  if (isWorkspace(workspace)) {
    state.workspaces.set(workspace.id, workspace);
  }
}

function applyTileEvent(state: MutableDesktopState, event: DesktopEvent): void {
  const tile = event.data as unknown as Tile;
  if (tileWasRemoved(event.event)) {
    if (typeof tile.id === "string") {
      state.tiles.delete(tile.id);
    }
    return;
  }
  if (isTile(tile)) {
    state.tiles.set(tile.id, tile);
  }
}

function applyTerminalEvent(state: MutableDesktopState, event: DesktopEvent): void {
  const terminal = event.data as unknown as Terminal;
  if (isTerminal(terminal)) {
    state.terminals.set(terminal.id, terminal);
  }
}

function applyUIEvent(state: MutableDesktopState, event: DesktopEvent): void {
  const data = event.data;
  state.ui = {
    level: isUILevel(data.level) ? data.level : state.ui.level,
    selectedWorkspaceId: nullableString(data.selectedWorkspaceId),
    selectedTileId: nullableString(data.selectedTileId),
    focusedTileId: nullableString(data.focusedTileId),
  };
}

function tileWasRemoved(event: string): boolean {
  return (
    event === "tile.deleted" ||
    event === "tile.disconnected" ||
    event === "tile.killed" ||
    // Compatibility with Desktop builds that used a timed close buffer.
    event === "tile.closed" ||
    event === "tile.closeFinalized"
  );
}

function isWorkspace(value: Workspace): boolean {
  return (
    typeof value?.id === "string" &&
    typeof value.name === "string" &&
    typeof value.location === "object" &&
    value.location !== null &&
    (value.location.kind === "local" || value.location.kind === "ssh")
  );
}

function isTile(value: Tile): boolean {
  return (
    typeof value?.id === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.terminalId === "string"
  );
}

function isTerminal(value: Terminal): boolean {
  return typeof value?.id === "string" && typeof value.tileId === "string";
}

function isUILevel(value: unknown): value is DesktopUIState["level"] {
  return value === "overview" || value === "workspace" || value === "terminal";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
