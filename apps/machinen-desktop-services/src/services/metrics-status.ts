import { execFile } from "node:child_process";
import { cpus } from "node:os";

import type {
  DesktopEvent,
  DesktopSnapshot,
  StatusScope,
  StatusTone,
  StatusWidget,
} from "@machinen/desktop-sdk";

import { DesktopState } from "../desktop-state.js";
import { reportServiceError, type StatusPublisher } from "../status-publisher.js";

const historyLength = 30;
const defaultPollIntervalMilliseconds = 1_000;
const hostWidgetTTLMilliseconds = 3_000;
const processWidgetTTLMilliseconds = 10_000;

interface HostTotals {
  cpuUsed: number;
  cpuTotal: number;
  incoming: number;
  outgoing: number;
  sampledAt: number;
}

interface ProcessTotals {
  cpuSeconds: number;
  incoming?: number;
  outgoing?: number;
  sampledAt: number;
}

interface ProcessContext {
  key: string;
  roots: number[];
  scope: StatusScope;
  displayPID?: number;
}

interface MetricsStatusServiceOptions {
  pollIntervalMilliseconds?: number;
  hostProbe?: (signal?: AbortSignal) => Promise<HostTotals>;
  processProbe?: (roots: number[], signal?: AbortSignal) => Promise<ProcessTotals>;
}

function execute(executable: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, signal },
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

export function parseNetworkInterfaces(output: string): { incoming: number; outgoing: number } {
  let incoming = 0;
  let outgoing = 0;
  for (const line of output.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (
      fields.length < 10 ||
      fields[0] === "lo0" ||
      fields[0]?.endsWith("*") ||
      !fields[2]?.startsWith("<Link#")
    ) {
      continue;
    }
    const rowIncoming = Number(fields.at(-5));
    const rowOutgoing = Number(fields.at(-2));
    if (Number.isFinite(rowIncoming) && Number.isFinite(rowOutgoing)) {
      incoming += rowIncoming;
      outgoing += rowOutgoing;
    }
  }
  return { incoming, outgoing };
}

async function probeHostTotals(signal?: AbortSignal): Promise<HostTotals> {
  const cores = cpus();
  const cpuUsed = cores.reduce(
    (total, core) => total + core.times.user + core.times.nice + core.times.sys + core.times.irq,
    0,
  );
  const cpuTotal = cores.reduce(
    (total, core) =>
      total + core.times.user + core.times.nice + core.times.sys + core.times.irq + core.times.idle,
    0,
  );
  const network = parseNetworkInterfaces(await execute("/usr/sbin/netstat", ["-ibn"], signal));
  return { cpuUsed, cpuTotal, ...network, sampledAt: performance.now() };
}

interface ProcessRow {
  pid: number;
  parentPID: number;
  cpuSeconds: number;
}

export function parseProcessElapsedCPU(output: string): ProcessRow[] {
  const result: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parentPID = Number(match[2]);
    const cpuSeconds = parseProcessTime(match[3]);
    if (Number.isFinite(cpuSeconds)) {
      result.push({ pid, parentPID, cpuSeconds });
    }
  }
  return result;
}

function parseProcessTime(value: string): number {
  const dayParts = value.split("-");
  const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
  const clock = dayParts.at(-1)?.split(":").map(Number) ?? [];
  if (clock.some((part) => !Number.isFinite(part)) || !Number.isFinite(days)) {
    return Number.NaN;
  }
  const seconds = clock.at(-1) ?? 0;
  const minutes = clock.at(-2) ?? 0;
  const hours = clock.at(-3) ?? 0;
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

export function processTree(rows: ProcessRow[], roots: number[]): ProcessRow[] {
  const wanted = new Set(roots.filter((pid) => pid > 0));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (wanted.has(row.parentPID) && !wanted.has(row.pid)) {
        wanted.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => wanted.has(row.pid));
}

export function parseNetworkBytes(
  output: string,
): { incoming: number; outgoing: number } | undefined {
  const rows = output.split("\n").filter(Boolean);
  const header = rows[0]?.split(",");
  if (!header) {
    return undefined;
  }
  const incomingIndex = header.indexOf("bytes_in");
  const outgoingIndex = header.indexOf("bytes_out");
  if (incomingIndex < 0 || outgoingIndex < 0) {
    return undefined;
  }
  let incoming = 0;
  let outgoing = 0;
  let found = false;
  for (const row of rows.slice(1)) {
    const values = row.split(",");
    const rowIncoming = Number(values[incomingIndex]);
    const rowOutgoing = Number(values[outgoingIndex]);
    if (Number.isFinite(rowIncoming) && Number.isFinite(rowOutgoing)) {
      incoming += rowIncoming;
      outgoing += rowOutgoing;
      found = true;
    }
  }
  return found ? { incoming, outgoing } : undefined;
}

async function probeProcessTotals(roots: number[], signal?: AbortSignal): Promise<ProcessTotals> {
  const rows = parseProcessElapsedCPU(
    await execute("/bin/ps", ["-axo", "pid=,ppid=,time="], signal),
  );
  const processes = processTree(rows, roots);
  const cpuSeconds = processes.reduce((total, row) => total + row.cpuSeconds, 0);
  const commands = processes.map(({ pid }) => `/usr/bin/nettop -P -L 1 -x -p ${pid}`);
  let network: { incoming: number; outgoing: number } | undefined;
  if (commands.length > 0) {
    try {
      network = parseNetworkBytes(await execute("/bin/sh", ["-c", commands.join("; ")], signal));
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
    }
  }
  return { cpuSeconds, ...network, sampledAt: performance.now() };
}

export class MetricsStatusService {
  private readonly pollIntervalMilliseconds: number;
  private readonly hostProbe: (signal?: AbortSignal) => Promise<HostTotals>;
  private readonly processProbe: (roots: number[], signal?: AbortSignal) => Promise<ProcessTotals>;
  private timer?: NodeJS.Timeout;
  private abortController?: AbortController;
  private running = false;
  private refreshQueued = false;
  private contextKey?: string;
  private previousHost?: HostTotals;
  private previousProcess?: ProcessTotals;
  private cpuHistory: number[] = [];
  private incomingHistory: number[] = [];
  private outgoingHistory: number[] = [];
  private lastError?: string;

  constructor(
    private readonly desktop: StatusPublisher,
    private readonly state: DesktopState,
    options: MetricsStatusServiceOptions = {},
  ) {
    this.pollIntervalMilliseconds =
      options.pollIntervalMilliseconds ?? defaultPollIntervalMilliseconds;
    this.hostProbe = options.hostProbe ?? probeHostTotals;
    this.processProbe = options.processProbe ?? probeProcessTotals;
  }

  start(_snapshot: DesktopSnapshot): void {
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
    this.abortController?.abort();
    this.abortController = undefined;
    this.running = false;
    this.refreshQueued = false;
  }

  handleEvent(event: DesktopEvent): void {
    if (event.event === "ui.changed") {
      this.contextChanged();
      return;
    }
    if (
      event.event.startsWith("workspace.") ||
      event.event.startsWith("tile.") ||
      event.event === "terminal.processChanged" ||
      event.event === "terminal.stateChanged"
    ) {
      const nextKey = this.currentContext()?.key ?? "none";
      if (nextKey !== this.contextKey) {
        this.contextChanged();
      }
    }
  }

  private contextChanged(): void {
    this.contextKey = this.currentContext()?.key ?? "none";
    this.abortController?.abort();
    this.previousHost = undefined;
    this.previousProcess = undefined;
    this.cpuHistory = [];
    this.incomingHistory = [];
    this.outgoingHistory = [];
    this.queueRefresh();
  }

  private currentContext(): ProcessContext | undefined {
    if (this.state.ui.level === "overview") {
      return undefined;
    }
    const workspace = this.state.selectedWorkspace();
    if (!workspace || workspace.location.kind !== "local") {
      return undefined;
    }
    return this.state.ui.level === "terminal"
      ? this.terminalContext()
      : this.workspaceContext(workspace.id);
  }

  private terminalContext(): ProcessContext | undefined {
    const terminal = this.state.selectedTerminal();
    const tile = terminal ? this.state.tiles.get(terminal.tileId) : undefined;
    if (!terminal || !tile?.pid) {
      return undefined;
    }
    return {
      key: `terminal:${terminal.id}:${tile.pid}`,
      roots: [tile.pid],
      scope: { kind: "terminal", id: terminal.id },
      displayPID: tile.pid,
    };
  }

  private workspaceContext(workspaceId: string): ProcessContext | undefined {
    const roots = this.state
      .workspaceTiles(workspaceId)
      .map((tile) => tile.pid)
      .filter((pid): pid is number => typeof pid === "number" && pid > 0)
      .sort((left, right) => left - right);
    return roots.length > 0
      ? {
          key: `workspace:${workspaceId}:${roots.join(",")}`,
          roots,
          scope: { kind: "workspace", id: workspaceId },
        }
      : undefined;
  }

  private queueRefresh(): void {
    if (this.running) {
      this.refreshQueued = true;
      return;
    }
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.running = true;
    this.refreshQueued = false;
    const key = this.contextKey;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      await this.refreshCurrentContext(key, controller);
      this.lastError = undefined;
    } catch (error) {
      this.reportRefreshError(error, controller.signal);
    } finally {
      this.finishRefresh(controller);
    }
  }

  private async refreshCurrentContext(
    key: string | undefined,
    controller: AbortController,
  ): Promise<void> {
    if (this.state.ui.level === "overview") {
      const totals = await this.hostProbe(controller.signal);
      if (!this.refreshIsStale(key, controller)) {
        await this.publishHost(totals);
      }
      return;
    }
    const context = this.currentContext();
    if (!context) {
      return;
    }
    const totals = await this.processProbe(context.roots, controller.signal);
    if (!this.refreshIsStale(key, controller)) {
      await this.publishProcess(context, totals);
    }
  }

  private reportRefreshError(error: unknown, signal: AbortSignal): void {
    const message = error instanceof Error ? error.message : String(error);
    if (signal.aborted || message === this.lastError) {
      return;
    }
    reportServiceError("Metrics status service", error);
    this.lastError = message;
  }

  private finishRefresh(controller: AbortController): void {
    const repeat = this.refreshQueued;
    this.running = false;
    this.refreshQueued = false;
    if (this.abortController === controller) {
      this.abortController = undefined;
    }
    if (repeat) {
      void this.refresh();
    }
  }

  private refreshIsStale(key: string | undefined, controller: AbortController): boolean {
    return controller.signal.aborted || key !== this.contextKey;
  }

  private async publishHost(totals: HostTotals): Promise<void> {
    if (this.previousHost) {
      const used = totals.cpuUsed - this.previousHost.cpuUsed;
      const total = totals.cpuTotal - this.previousHost.cpuTotal;
      if (used >= 0 && total > 0) {
        append(used / total, this.cpuHistory);
      }
      appendRates(totals, this.previousHost, this.incomingHistory, this.outgoingHistory);
    }
    this.previousHost = totals;
    await Promise.all(
      hostWidgets(this.cpuHistory, this.incomingHistory, this.outgoingHistory).map((widget) =>
        this.desktop.status.set(widget),
      ),
    );
  }

  private async publishProcess(context: ProcessContext, totals: ProcessTotals): Promise<void> {
    if (this.previousProcess) {
      const elapsed = Math.max(0.001, (totals.sampledAt - this.previousProcess.sampledAt) / 1_000);
      const cpu = totals.cpuSeconds - this.previousProcess.cpuSeconds;
      if (cpu >= 0) {
        append(cpu / elapsed, this.cpuHistory);
      }
      appendRates(totals, this.previousProcess, this.incomingHistory, this.outgoingHistory);
    }
    this.previousProcess = totals;
    await Promise.all(
      processWidgets(context, this.cpuHistory, this.incomingHistory, this.outgoingHistory).map(
        (widget) => this.desktop.status.set(widget),
      ),
    );
  }
}

function appendRates(
  current: { incoming?: number; outgoing?: number; sampledAt: number },
  previous: { incoming?: number; outgoing?: number; sampledAt: number },
  incomingHistory: number[],
  outgoingHistory: number[],
): void {
  if (
    current.incoming === undefined ||
    current.outgoing === undefined ||
    previous.incoming === undefined ||
    previous.outgoing === undefined ||
    current.incoming < previous.incoming ||
    current.outgoing < previous.outgoing
  ) {
    return;
  }
  const elapsed = Math.max(0.001, (current.sampledAt - previous.sampledAt) / 1_000);
  append((current.incoming - previous.incoming) / elapsed, incomingHistory);
  append((current.outgoing - previous.outgoing) / elapsed, outgoingHistory);
}

function append(value: number, history: number[]): void {
  history.push(Math.max(0, value));
  if (history.length > historyLength) {
    history.splice(0, history.length - historyLength);
  }
}

function hostWidgets(cpu: number[], incoming: number[], outgoing: number[]): StatusWidget[] {
  const result: StatusWidget[] = [];
  const latestCPU = cpu.at(-1);
  if (latestCPU !== undefined) {
    result.push(
      cpuWidget(
        "machinen.cpu",
        { kind: "global" },
        "System CPU",
        `System CPU ${Math.round(latestCPU * 100)}%`,
        latestCPU,
        cpu,
        50,
        hostWidgetTTLMilliseconds,
      ),
    );
  }
  if (incoming.length > 0 && outgoing.length > 0) {
    result.push(
      networkWidget(
        "machinen.network",
        { kind: "global" },
        "Network transfer",
        `Network ↓${formatRate(incoming.at(-1) ?? 0)} · ↑${formatRate(outgoing.at(-1) ?? 0)}`,
        incoming,
        outgoing,
        40,
        hostWidgetTTLMilliseconds,
      ),
    );
  }
  return result;
}

function processWidgets(
  context: ProcessContext,
  cpu: number[],
  incoming: number[],
  outgoing: number[],
): StatusWidget[] {
  return [processCPUWidget(context, cpu), processNetworkWidget(context, incoming, outgoing)].filter(
    (widget): widget is StatusWidget => widget !== undefined,
  );
}

function processCPUWidget(context: ProcessContext, cpu: number[]): StatusWidget | undefined {
  const latestCPU = cpu.at(-1);
  if (latestCPU === undefined) {
    return undefined;
  }
  const focused = context.displayPID !== undefined;
  return cpuWidget(
    "machinen.pid.cpu",
    context.scope,
    focused ? "PID CPU" : "Tiles CPU",
    focused
      ? `PID ${context.displayPID} + children CPU ${Math.round(latestCPU * 100)}%`
      : `Workspace tiles CPU ${Math.round(latestCPU * 100)}%`,
    latestCPU,
    cpu,
    70,
    processWidgetTTLMilliseconds,
  );
}

function processNetworkWidget(
  context: ProcessContext,
  incoming: number[],
  outgoing: number[],
): StatusWidget | undefined {
  if (incoming.length === 0 || outgoing.length === 0) {
    return undefined;
  }
  const focused = context.displayPID !== undefined;
  return networkWidget(
    "machinen.pid.network",
    context.scope,
    focused ? "PID network" : "Tiles network",
    focused
      ? `PID ${context.displayPID} + children network ↓${formatRate(incoming.at(-1) ?? 0)} · ↑${formatRate(outgoing.at(-1) ?? 0)}`
      : `Workspace tiles network ↓${formatRate(incoming.at(-1) ?? 0)} · ↑${formatRate(outgoing.at(-1) ?? 0)}`,
    incoming,
    outgoing,
    60,
    processWidgetTTLMilliseconds,
  );
}

function cpuWidget(
  id: string,
  scope: StatusScope,
  label: string,
  tooltip: string,
  latest: number,
  samples: number[],
  priority: number,
  ttlMilliseconds: number,
): StatusWidget {
  let tone: StatusTone = "busy";
  if (latest > 0.92) {
    tone = "error";
  } else if (latest > 0.72) {
    tone = "attention";
  }
  return {
    id,
    scope,
    placement: "right",
    kind: "sparkline",
    label,
    value: `${Math.round(latest * 100)}%`,
    tone,
    tooltip,
    priority,
    ttlMilliseconds,
    graphStyle: "area",
    samples: [...samples],
  };
}

function networkWidget(
  id: string,
  scope: StatusScope,
  label: string,
  tooltip: string,
  incoming: number[],
  outgoing: number[],
  priority: number,
  ttlMilliseconds: number,
): StatusWidget {
  return {
    id,
    scope,
    placement: "right",
    kind: "sparkline",
    label,
    value: `↓${formatCompactRate(incoming.at(-1) ?? 0)} ↑${formatCompactRate(outgoing.at(-1) ?? 0)}`,
    tone: "busy",
    tooltip,
    priority,
    ttlMilliseconds,
    graphStyle: "mirrored",
    samples: [...incoming],
    secondarySamples: [...outgoing],
  };
}

function formatRate(bytesPerSecond: number): string {
  return formattedRate(bytesPerSecond, " MB/s", " KB/s", " B/s");
}

function formatCompactRate(bytesPerSecond: number): string {
  return formattedRate(bytesPerSecond, "M", "K", "B");
}

function formattedRate(
  bytesPerSecond: number,
  megabytesSuffix: string,
  kilobytesSuffix: string,
  bytesSuffix: string,
): string {
  if (bytesPerSecond >= 1_000_000) {
    return `${(bytesPerSecond / 1_000_000).toFixed(1)}${megabytesSuffix}`;
  }
  if (bytesPerSecond >= 1_000) {
    return `${Math.round(bytesPerSecond / 1_000)}${kilobytesSuffix}`;
  }
  return `${Math.trunc(bytesPerSecond)}${bytesSuffix}`;
}
