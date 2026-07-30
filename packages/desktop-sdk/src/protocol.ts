export type JsonObject = Record<string, unknown>;

export type WorkspaceLocation =
  | { kind: "local"; path: string }
  | { kind: "ssh"; host: string; path: string };

export interface Workspace {
  id: string;
  name: string;
  machineId: string;
  location: WorkspaceLocation;
  workingDirectory: string;
  position: number;
  tileIds: string[];
}

export interface Tile {
  id: string;
  workspaceId: string;
  kind: "terminal";
  name: string;
  label: string;
  pid: number | null;
  shellPid: number | null;
  position: number;
  terminalId: string;
  viewerState: "attached" | "detached";
}

export interface Terminal {
  id: string;
  tileId: string;
  pid: number | null;
  shellPid: number | null;
  workingDirectory: string;
  currentWorkingDirectory: string | null;
  location: WorkspaceLocation;
  backend: "machinenSession";
  processState: "starting" | "running" | "stopped" | "exited" | "disconnected";
  activityState: "working" | "waiting" | "idle" | "unknown";
  viewerState: "attached" | "detached";
  [key: string]: unknown;
}

export interface DesktopUIState {
  level: "overview" | "workspace" | "terminal";
  selectedWorkspaceId: string | null;
  selectedTileId: string | null;
  focusedTileId: string | null;
}

export interface DesktopSnapshot {
  workspaces: Workspace[];
  tiles: Tile[];
  terminals: Terminal[];
  ui: DesktopUIState;
}

export type StatusScope =
  | { kind: "global" }
  | { kind: "machine"; id: string }
  | { kind: "workspace"; id: string }
  | { kind: "terminal"; id: string };

export type StatusWidgetKind =
  | "text"
  | "count"
  | "state"
  | "progress"
  | "timer"
  | "sparkline"
  | "separator";

export type StatusTone = "neutral" | "good" | "busy" | "attention" | "error";
export type StatusGraphStyle = "line" | "area" | "bars" | "mirrored";

export interface StatusWidgetLink {
  title: string;
  url: string;
}

export type CommandContext = "workspace" | "terminal";

export interface ContextCommandDefinition extends JsonObject {
  id: string;
  title: string;
  subtitle?: string;
  group?: string;
  context: CommandContext;
  locationKinds?: Array<WorkspaceLocation["kind"]>;
  priority?: number;
  ttlMilliseconds?: number;
}

export interface ContextCommandInvocation extends JsonObject {
  invocationId: string;
  commandId: string;
  context: CommandContext;
  workspaceId: string;
  tileId?: string;
  terminalId?: string;
  workingDirectory: string;
  location: WorkspaceLocation;
}

export interface SelectionOpenerDefinition extends JsonObject {
  id: string;
  title: string;
  subtitle?: string;
  selectionPattern?: string;
  locationKinds?: Array<WorkspaceLocation["kind"]>;
  priority?: number;
  ttlMilliseconds?: number;
}

export interface SelectionOpenerInvocation extends JsonObject {
  invocationId: string;
  openerId: string;
  selection: string;
  workspaceId: string;
  tileId: string;
  terminalId: string;
  workingDirectory: string;
  location: WorkspaceLocation;
}

export interface StatusWidget {
  id: string;
  scope?: StatusScope;
  placement?: "left" | "right";
  kind?: StatusWidgetKind;
  label?: string;
  value?: string | number;
  progress?: number;
  tone?: StatusTone;
  tooltip?: string;
  priority?: number;
  ttlMilliseconds?: number;
  graphStyle?: StatusGraphStyle;
  samples?: number[];
  secondarySamples?: number[];
  states?: Array<
    "working" | "waiting" | "idle" | "unknown" | "neutral" | "good" | "busy" | "attention" | "error"
  >;
  links?: StatusWidgetLink[];
}

export type DesktopEventName =
  | "system.shuttingDown"
  | "workspace.created"
  | "workspace.restored"
  | "workspace.updated"
  | "workspace.moved"
  | "workspace.deleted"
  | "tile.created"
  | "tile.updated"
  | "tile.moved"
  | "tile.viewerChanged"
  | "tile.deleted"
  | "terminal.stateChanged"
  | "terminal.activityChanged"
  | "terminal.commandChanged"
  | "terminal.workingDirectoryChanged"
  | "terminal.updated"
  | "terminal.output"
  | "status.changed"
  | "command.changed"
  | "command.invoked"
  | "selectionOpener.changed"
  | "selectionOpener.invoked"
  | "ui.changed";

export interface DesktopEvent {
  type: "event";
  seq: number;
  event: DesktopEventName | (string & {});
  at?: string;
  data: JsonObject;
}

export interface EventSubscriptionParams extends JsonObject {
  events?: string[];
  workspaceIds?: string[];
  tileIds?: string[];
  terminalIds?: string[];
  includeOutput?: boolean;
  includeSnapshot?: boolean;
}

export interface EventSubscriptionResult extends JsonObject {
  subscriptionId: string;
  snapshot?: DesktopSnapshot;
}

export interface DesktopClientIdentity {
  name: string;
  version: string;
}

export interface DesktopConnection {
  hello: JsonObject;
  subscription?: EventSubscriptionResult;
}
