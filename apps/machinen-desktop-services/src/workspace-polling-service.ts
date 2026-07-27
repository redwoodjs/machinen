import type {
  DesktopEvent,
  DesktopSnapshot,
  Workspace,
  WorkspaceLocation,
} from "@machinen/desktop-sdk";

import { DesktopState } from "./desktop-state.js";
import { reportServiceError } from "./status-publisher.js";

interface DesktopService {
  start(snapshot: DesktopSnapshot): void;
  stop(): void;
  handleEvent(event: DesktopEvent): void;
}

interface WorkspacePollingServiceOptions<Result> {
  name: string;
  pollIntervalMilliseconds: number;
  probe: (location: WorkspaceLocation, signal?: AbortSignal) => Promise<Result>;
  publish: (workspace: Workspace, result: Result) => Promise<unknown>;
}

export class WorkspacePollingService<Result> implements DesktopService {
  private timer?: NodeJS.Timeout;
  private abortController?: AbortController;
  private running = false;
  private refreshQueued = false;
  private contextVersion = 0;
  private selectedWorkspaceId?: string;
  private lastError?: string;

  constructor(
    private readonly state: DesktopState,
    private readonly options: WorkspacePollingServiceOptions<Result>,
  ) {}

  start(snapshot: DesktopSnapshot): void {
    this.state.load(snapshot);
    this.contextChanged();
    if (!this.timer) {
      this.timer = setInterval(() => this.queueRefresh(), this.options.pollIntervalMilliseconds);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = undefined;
    this.contextVersion += 1;
    this.abortController?.abort();
    this.abortController = undefined;
    this.running = false;
    this.refreshQueued = false;
  }

  handleEvent(event: DesktopEvent): void {
    const workspaceId = event.data.id;
    if (
      event.event === "ui.changed" ||
      (event.event.startsWith("workspace.") && workspaceId === this.selectedWorkspaceId)
    ) {
      this.contextChanged();
    }
  }

  private contextChanged(): void {
    this.selectedWorkspaceId = this.state.ui.selectedWorkspaceId ?? undefined;
    this.contextVersion += 1;
    this.abortController?.abort();
    this.queueRefresh();
  }

  private queueRefresh(): void {
    if (this.running) {
      this.refreshQueued = true;
      return;
    }
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const workspace = this.state.selectedWorkspace();
    if (!workspace) {
      return;
    }

    const version = this.contextVersion;
    const controller = new AbortController();
    this.abortController = controller;
    this.running = true;
    this.refreshQueued = false;
    try {
      await this.probeAndPublish(workspace, version, controller);
      this.lastError = undefined;
    } catch (error) {
      this.reportRefreshError(error, controller.signal);
    } finally {
      this.finishRefresh(controller);
    }
  }

  private async probeAndPublish(
    workspace: Workspace,
    version: number,
    controller: AbortController,
  ): Promise<void> {
    const result = await this.options.probe(workspace.location, controller.signal);
    if (version === this.contextVersion && !controller.signal.aborted) {
      await this.options.publish(workspace, result);
    }
  }

  private reportRefreshError(error: unknown, signal: AbortSignal): void {
    if (signal.aborted) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message !== this.lastError) {
      reportServiceError(this.options.name, error);
      this.lastError = message;
    }
  }

  private finishRefresh(controller: AbortController): void {
    if (this.abortController === controller) {
      this.abortController = undefined;
    }
    this.running = false;
    if (this.refreshQueued) {
      this.queueRefresh();
    }
  }
}
