import type {
  DesktopEvent,
  DesktopSnapshot,
  StatusTone,
  StatusWidget,
} from "@machinen/desktop-sdk";

import { DesktopState } from "../desktop-state.js";
import { reportServiceError, type StatusPublisher } from "../status-publisher.js";

const defaultRefreshIntervalMilliseconds = 4_000;
const widgetTTLMilliseconds = 10_000;

export class ActivityStatusService {
  private timer?: NodeJS.Timeout;
  private publishing = false;
  private refreshQueued = false;

  constructor(
    private readonly desktop: StatusPublisher,
    private readonly state: DesktopState,
    private readonly refreshIntervalMilliseconds = defaultRefreshIntervalMilliseconds,
  ) {}

  start(_snapshot: DesktopSnapshot): void {
    this.queueRefresh();
    if (!this.timer) {
      this.timer = setInterval(() => this.queueRefresh(), this.refreshIntervalMilliseconds);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = undefined;
    this.refreshQueued = false;
  }

  handleEvent(event: DesktopEvent): void {
    if (
      event.event === "ui.changed" ||
      event.event.startsWith("workspace.") ||
      event.event.startsWith("tile.") ||
      event.event === "terminal.activityChanged" ||
      event.event === "terminal.stateChanged"
    ) {
      this.queueRefresh();
    }
  }

  private queueRefresh(): void {
    if (this.publishing) {
      this.refreshQueued = true;
      return;
    }
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const widget = activityWidget(this.state);
    if (!widget) {
      return;
    }
    this.publishing = true;
    this.refreshQueued = false;
    try {
      await this.desktop.status.set(widget);
    } catch (error) {
      reportServiceError("Activity status service", error);
    } finally {
      this.publishing = false;
      if (this.refreshQueued) {
        this.queueRefresh();
      }
    }
  }
}

export function activityWidget(state: DesktopState): StatusWidget | undefined {
  const workspace = state.selectedWorkspace();
  if (!workspace) {
    return undefined;
  }
  const tiles = state.workspaceTiles(workspace.id);
  if (tiles.length === 0) {
    return undefined;
  }

  const states = tiles.map((tile) => {
    const terminal = state.terminalForTile(tile);
    if (terminal?.processState === "exited" || terminal?.processState === "disconnected") {
      return "error" as const;
    }
    return terminal?.activityState ?? ("unknown" as const);
  });
  const summaryOrder = ["waiting", "working", "idle", "error", "unknown"] as const;
  const tooltip = summaryOrder
    .map((activity) => {
      const count = states.filter((state) => state === activity).length;
      const label = activity === "working" ? "active" : activity;
      return count > 0 ? `${count} ${label}` : undefined;
    })
    .filter((value): value is string => value !== undefined)
    .join(" · ");

  let tone: StatusTone = "neutral";
  if (states.includes("error")) {
    tone = "error";
  } else if (states.includes("waiting")) {
    tone = "attention";
  } else if (states.includes("working")) {
    tone = "busy";
  }

  return {
    id: "machinen.activity",
    scope: { kind: "workspace", id: workspace.id },
    placement: "right",
    kind: "state",
    value: "",
    tone,
    tooltip,
    priority: 100,
    ttlMilliseconds: widgetTTLMilliseconds,
    states,
  };
}
