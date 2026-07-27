import type {
  DesktopEvent,
  DesktopSnapshot,
  DesktopUIState,
  Terminal,
  Tile,
  Workspace,
} from "@machinen/desktop-sdk";

import { applyDesktopEvent } from "./desktop-state-events.js";

export class DesktopState {
  readonly workspaces = new Map<string, Workspace>();
  readonly tiles = new Map<string, Tile>();
  readonly terminals = new Map<string, Terminal>();
  ui: DesktopUIState = {
    level: "overview",
    selectedWorkspaceId: null,
    selectedTileId: null,
    focusedTileId: null,
  };

  load(snapshot: DesktopSnapshot): void {
    this.workspaces.clear();
    this.tiles.clear();
    this.terminals.clear();
    for (const workspace of snapshot.workspaces) {
      this.workspaces.set(workspace.id, workspace);
    }
    for (const tile of snapshot.tiles) {
      this.tiles.set(tile.id, tile);
    }
    for (const terminal of snapshot.terminals) {
      this.terminals.set(terminal.id, terminal);
    }
    this.ui = snapshot.ui;
  }

  handleEvent(event: DesktopEvent): void {
    applyDesktopEvent(this, event);
  }

  selectedWorkspace(): Workspace | undefined {
    return this.ui.selectedWorkspaceId
      ? this.workspaces.get(this.ui.selectedWorkspaceId)
      : undefined;
  }

  selectedTerminal(): Terminal | undefined {
    const tileId = this.ui.focusedTileId;
    if (!tileId) {
      return undefined;
    }
    const terminalId = this.tiles.get(tileId)?.terminalId;
    return terminalId ? this.terminals.get(terminalId) : undefined;
  }

  workspaceTiles(workspaceId: string): Tile[] {
    return [...this.tiles.values()]
      .filter((tile) => tile.workspaceId === workspaceId)
      .sort((left, right) => left.position - right.position);
  }

  terminalForTile(tile: Tile): Terminal | undefined {
    return this.terminals.get(tile.terminalId);
  }
}
