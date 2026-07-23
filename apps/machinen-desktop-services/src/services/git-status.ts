import { execFile } from "node:child_process";

import type {
  DesktopEvent,
  DesktopSnapshot,
  StatusWidget,
  Workspace,
  WorkspaceLocation,
} from "@machinen/desktop-sdk";

const outputMarker = "---MACHINEN-NUMSTAT---";
const defaultPollIntervalMilliseconds = 4_000;
const widgetTTLMilliseconds = 10_000;

export interface GitMetrics {
  branch: string;
  modified: number;
  additions: number;
  deletions: number;
  additionBars: number[];
  deletionBars: number[];
}

interface StatusPublisher {
  status: {
    set(widget: StatusWidget): Promise<unknown>;
  };
}

interface GitStatusServiceOptions {
  pollIntervalMilliseconds?: number;
  probe?: (location: WorkspaceLocation, signal?: AbortSignal) => Promise<GitMetrics>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function remoteShellPath(path: string): string {
  if (path === "~") {
    return '"$HOME"';
  }
  if (path.startsWith("~/")) {
    return `"$HOME"/${shellQuote(path.slice(2))}`;
  }
  return shellQuote(path);
}

export function remoteGitProbeCommand(path: string): string {
  const directory = remoteShellPath(path);
  return [
    `/usr/bin/git -C ${directory} status --porcelain=v1 --branch || exit 1`,
    `printf '\\n${outputMarker}\\n'`,
    `/usr/bin/git -C ${directory} diff --numstat HEAD 2>/dev/null || true`,
  ].join("\n");
}

function execute(
  executable: string,
  args: string[],
  options: { environment?: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        env: options.environment,
        maxBuffer: 1024 * 1024,
        signal: options.signal,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

export async function probeGit(
  location: WorkspaceLocation,
  signal?: AbortSignal,
): Promise<GitMetrics> {
  let output: string;
  if (location.kind === "local") {
    const environment = { ...process.env, MACHINEN_STATUS_DIRECTORY: location.path };
    const script = [
      '/usr/bin/git -C "$MACHINEN_STATUS_DIRECTORY" status --porcelain=v1 --branch || exit 1',
      `printf '\\n${outputMarker}\\n'`,
      '/usr/bin/git -C "$MACHINEN_STATUS_DIRECTORY" diff --numstat HEAD 2>/dev/null || true',
    ].join("\n");
    output = await execute("/bin/sh", ["-c", script], { environment, signal });
  } else {
    output = await execute(
      "/usr/bin/ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        location.host,
        remoteGitProbeCommand(location.path),
      ],
      { signal },
    );
  }

  const metrics = parseGitOutput(output);
  if (!metrics) {
    throw new Error(`Git returned an invalid status for ${location.path}`);
  }
  return metrics;
}

export function parseGitOutput(output: string): GitMetrics | undefined {
  const sections = output.split(outputMarker);
  const statusLines = sections[0]?.split("\n").filter(Boolean) ?? [];
  const header = statusLines[0];
  if (!header?.startsWith("## ")) {
    return undefined;
  }

  const branchDescription = header.slice(3);
  const branch = branchDescription.replace(/^No commits yet on /, "").split("...")[0];
  const modified = Math.max(0, statusLines.length - 1);
  const additions: number[] = [];
  const deletions: number[] = [];

  for (const line of sections[1]?.split("\n") ?? []) {
    if (!line) {
      continue;
    }
    const fields = line.split("\t");
    if (fields.length < 2) {
      continue;
    }
    additions.push(Number(fields[0]) || 0);
    deletions.push(Number(fields[1]) || 0);
  }

  while (additions.length < modified) {
    additions.push(1);
    deletions.push(0);
  }
  if (additions.length === 0) {
    additions.push(0);
    deletions.push(0);
  }

  const ranked = additions
    .map((addition, index) => ({ addition, deletion: deletions[index] ?? 0 }))
    .sort((left, right) => right.addition + right.deletion - (left.addition + left.deletion))
    .slice(0, 14);

  return {
    branch,
    modified,
    additions: additions.reduce((total, value) => total + value, 0),
    deletions: deletions.reduce((total, value) => total + value, 0),
    additionBars: ranked.map(({ addition }) => addition),
    deletionBars: ranked.map(({ deletion }) => deletion),
  };
}

export class GitStatusService {
  private readonly pollIntervalMilliseconds: number;
  private readonly probe: (
    location: WorkspaceLocation,
    signal?: AbortSignal,
  ) => Promise<GitMetrics>;
  private workspaces = new Map<string, Workspace>();
  private selectedWorkspaceId: string | null = null;
  private timer?: NodeJS.Timeout;
  private abortController?: AbortController;
  private running = false;
  private refreshQueued = false;
  private contextVersion = 0;
  private lastError?: string;

  constructor(
    private readonly desktop: StatusPublisher,
    options: GitStatusServiceOptions = {},
  ) {
    this.pollIntervalMilliseconds =
      options.pollIntervalMilliseconds ?? defaultPollIntervalMilliseconds;
    this.probe = options.probe ?? probeGit;
  }

  start(snapshot: DesktopSnapshot): void {
    this.workspaces = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace]));
    this.selectedWorkspaceId = snapshot.ui.selectedWorkspaceId;
    this.contextChanged();
    if (!this.timer) {
      this.timer = setInterval(() => this.queueRefresh(), this.pollIntervalMilliseconds);
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
    if (event.event.startsWith("workspace.")) {
      const workspace = event.data as unknown as Workspace;
      if (event.event === "workspace.deleted") {
        if (typeof workspace.id === "string") {
          this.workspaces.delete(workspace.id);
        }
      } else if (isWorkspace(workspace)) {
        this.workspaces.set(workspace.id, workspace);
      }
      if (workspace.id === this.selectedWorkspaceId) {
        this.contextChanged();
      }
      return;
    }

    if (event.event === "ui.changed") {
      const selected = event.data.selectedWorkspaceId;
      const workspaceId = typeof selected === "string" ? selected : null;
      if (workspaceId !== this.selectedWorkspaceId) {
        this.selectedWorkspaceId = workspaceId;
        this.contextChanged();
      }
    }
  }

  private contextChanged(): void {
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
    const workspace = this.selectedWorkspace();
    if (!workspace) {
      return;
    }

    const version = this.contextVersion;
    const controller = this.beginRefresh();

    try {
      const git = await this.probe(workspace.location, controller.signal);
      if (this.refreshIsStale(version, controller)) {
        return;
      }
      await this.desktop.status.set(gitStatusWidget(workspace, git));
      this.lastError = undefined;
    } catch (error) {
      this.reportRefreshError(error, controller.signal);
    } finally {
      this.finishRefresh(controller);
    }
  }

  private selectedWorkspace(): Workspace | undefined {
    if (!this.selectedWorkspaceId) {
      return undefined;
    }
    return this.workspaces.get(this.selectedWorkspaceId);
  }

  private beginRefresh(): AbortController {
    this.running = true;
    this.refreshQueued = false;
    const controller = new AbortController();
    this.abortController = controller;
    return controller;
  }

  private refreshIsStale(version: number, controller: AbortController): boolean {
    return version !== this.contextVersion || controller.signal.aborted;
  }

  private reportRefreshError(error: unknown, signal: AbortSignal): void {
    if (signal.aborted) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === this.lastError) {
      return;
    }
    console.error(`Git status service: ${message}`);
    this.lastError = message;
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

function gitStatusWidget(workspace: Workspace, git: GitMetrics): StatusWidget {
  return {
    id: "machinen.git",
    scope: { kind: "workspace", id: workspace.id },
    placement: "right",
    kind: "sparkline",
    label: "Git changes",
    value: `+${git.additions} −${git.deletions}`,
    tone: git.modified === 0 ? "good" : "attention",
    tooltip: `${git.branch} · ${git.modified} modified · +${git.additions} · −${git.deletions}`,
    priority: 90,
    ttlMilliseconds: widgetTTLMilliseconds,
    graphStyle: "bars",
    samples: git.additionBars,
    secondarySamples: git.deletionBars,
  };
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
